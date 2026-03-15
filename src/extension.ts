import * as vscode from 'vscode';
import { getGitHubToken } from './auth/github';
import { getRenderApiKey, clearRenderApiKey } from './auth/render';
import { detectProject, ProjectInfo } from './deploy/detector';
import { PROJECT_TYPES } from './deploy/projectTypes';
import { scaffoldForDeploy } from './deploy/scaffolder';
import { checkForIssues } from './deploy/checker';
import { RenderClient, RenderGitHubAccessError, RenderPaymentError } from './deploy/renderApi';
import { ensureGitHubRepo, pushToGitHub, getUncommittedFiles, stageAndCommit } from './github/index';
import { SamosaSidebarProvider, DeployStep } from './ui/sidebarView';

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

const PROJECT_TYPE_DEFAULTS = Object.fromEntries(
  PROJECT_TYPES.map(t => [t.label, { type: t.type, buildCommand: t.buildCommand, startCommand: t.startCommand, runtime: t.runtime }])
) as Record<string, Omit<ProjectInfo, 'name'>>;

async function runDeploy(context: vscode.ExtensionContext, sidebar: SamosaSidebarProvider): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    sidebar.sendError('Open a project folder before deploying.');
    return;
  }

  const githubToken = await getGitHubToken();
  const renderApiKey = await getRenderApiKey(context.secrets);
  if (!githubToken || !renderApiKey) {
    await sidebar.sendIdle();
    return;
  }

  // ── Define steps ────────────────────────────────────────────────────────
  const steps: DeployStep[] = [
    { label: 'Detect project type',    status: 'active'  },
    { label: 'Set up deployment files', status: 'pending' },
    { label: 'Commit changes',          status: 'pending' },
    { label: 'Push to GitHub',          status: 'pending' },
    { label: 'Deploy to Render',        status: 'pending' },
  ];

  const advance = (i: number, label?: string, status: DeployStep['status'] = 'done') => {
    steps[i].status = status;
    if (label) steps[i].label = label;
    if (status === 'done' && i + 1 < steps.length) steps[i + 1].status = 'active';
    sidebar.sendProgress([...steps]);
  };

  sidebar.sendProgress([...steps]);

  try {
    // ── Step 0: Detect project type ────────────────────────────────────────
    let projectInfo = detectProject(workspaceRoot);

    if (projectInfo.type === 'unknown') {
      const result = await sidebar.ask<{ command: string; label?: string }>({
        command: 'state', screen: 'pick-project-type',
      });
      sidebar.sendProgress([...steps]); // restore progress after sub-screen
      if (!result || result.command !== 'project-type-selected') { await sidebar.sendIdle(); return; }
      const defaults = PROJECT_TYPE_DEFAULTS[result.label ?? ''];
      if (!defaults) { await sidebar.sendIdle(); return; }
      Object.assign(projectInfo, { ...defaults });
    }
    advance(0, `Detected: ${projectInfo.type}`);

    // ── Pre-flight checks ──────────────────────────────────────────────────
    const issues = checkForIssues(workspaceRoot, projectInfo);
    if (issues.length > 0) {
      const result = await sidebar.sendWarnings(issues);
      sidebar.sendProgress([...steps]);
      if (!result || result.command === 'warnings-cancelled') { await sidebar.sendIdle(); return; }
    }

    // ── Step 1: Scaffold files ─────────────────────────────────────────────
    const { created, envVars } = scaffoldForDeploy(workspaceRoot, projectInfo);
    advance(1, created.length > 0 ? `Created: ${created.join(', ')}` : 'Files ready');

    // ── Step 2: Commit ─────────────────────────────────────────────────────
    const { files, isFirstCommit } = getUncommittedFiles(workspaceRoot);
    if (files.length > 0) {
      const defaultMsg = isFirstCommit ? '[samosa] initial commit' : '[samosa] prepare for deployment';
      const result = await sidebar.ask<{ command: string; message?: string }>({
        command: 'state', screen: 'ask-commit',
        defaultMsg, files: files.slice(0, 10),
      });
      sidebar.sendProgress([...steps]);
      if (!result || result.command === 'commit-cancelled') { await sidebar.sendIdle(); return; }
      const msg = result.message || defaultMsg;
      stageAndCommit(workspaceRoot, msg);
      advance(2, `Committed: "${msg}"`);
    } else {
      advance(2, 'Nothing to commit');
    }

    // ── Step 3: Push to GitHub ─────────────────────────────────────────────
    const repoUrl = await ensureGitHubRepo(workspaceRoot, githubToken, projectInfo.name);
    await pushToGitHub(workspaceRoot, githubToken);
    advance(3, 'Pushed to GitHub');

    // ── Step 4: Deploy to Render ───────────────────────────────────────────
    const renderClient = new RenderClient(renderApiKey);
    const ownerId = await renderClient.getOwnerId();

    // Use cached plan, default to 'free'; prompt once if payment required
    let plan = context.globalState.get<string>('samosa.renderPlan', 'free');
    let service: Awaited<ReturnType<typeof renderClient.findOrCreateService>>;

    while (true) {
      try {
        service = await renderClient.findOrCreateService({
          name: projectInfo.name, ownerId, repoUrl,
          type: projectInfo.type,
          buildCommand: projectInfo.buildCommand,
          startCommand: projectInfo.startCommand,
          plan, envVars,
        });
        break;
      } catch (err) {
        if (err instanceof RenderPaymentError) {
          const result = await sidebar.ask<{ command: string; plan?: string }>({
            command: 'state', screen: 'pick-plan',
          });
          sidebar.sendProgress([...steps]);
          if (!result || result.command !== 'plan-selected') { await sidebar.sendIdle(); return; }
          plan = result.plan ?? 'starter';
          await context.globalState.update('samosa.renderPlan', plan);
        } else {
          throw err;
        }
      }
    }

    if (service!.existed) await renderClient.triggerDeploy(service!.id);
    advance(4, 'Deployed!');

    const serviceUrl = service.serviceDetails?.url ?? `https://${projectInfo.name}.onrender.com`;
    sidebar.sendSuccess(serviceUrl, service.id);

  } catch (err: unknown) {
    const activeIdx = steps.findIndex(s => s.status === 'active');
    if (activeIdx >= 0) steps[activeIdx].status = 'error';
    sidebar.sendProgress([...steps]);

    if (err instanceof RenderGitHubAccessError) {
      sidebar.sendError(
        "Render has lost access to your GitHub. On the page that opens, select your GitHub account, choose All repositories, and click Save — then deploy again.",
        { label: 'Reconnect GitHub on Render', url: 'https://dashboard.render.com/select-repo?type=web' }
      );
    } else {
      sidebar.sendError(err instanceof Error ? err.message : String(err));
    }
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sidebar = new SamosaSidebarProvider(context, () => runDeploy(context, sidebar));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SamosaSidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('samosa.deploy', () => runDeploy(context, sidebar)),
    vscode.commands.registerCommand('samosa.logout', async () => {
      await clearRenderApiKey(context.secrets);
      sidebar.refresh();
    })
  );
}

export function deactivate(): void {}
