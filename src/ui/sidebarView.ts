import * as vscode from 'vscode';
import { getGitHubToken, getGitHubSession } from '../auth/github';
import { getRenderApiKey, validateAndSaveRenderApiKey, clearRenderApiKey } from '../auth/render';
import { PROJECT_TYPES } from '../deploy/projectTypes';

export interface DeployStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

type Resolver = (value: unknown) => void;

export class SamosaSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'samosa.panel';
  private _view?: vscode.WebviewView;
  private _resolver?: Resolver;
  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _onDeploy: () => Promise<void>
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._shellHtml();

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && !this._resolver) this.sendIdle();
    });

    webviewView.webview.onDidReceiveMessage(async (msg: { command: string; [k: string]: unknown }) => {
      switch (msg.command) {
        case 'ready':
          await this.sendIdle();
          break;
        case 'connect-github':
          await getGitHubSession('create');
          await this.sendIdle();
          break;
        case 'reconnect-github':
          await getGitHubSession('force');
          await this.sendIdle();
          break;
        case 'remove-render-key':
          await clearRenderApiKey(this._context.secrets);
          await this.sendIdle();
          break;
        case 'render-key-submit': {
          const key = (msg.key as string) ?? '';
          this._post({ command: 'render-key-validating' });
          const ok = await validateAndSaveRenderApiKey(this._context.secrets, key);
          if (ok) { await this.sendIdle(); } else { this._post({ command: 'render-key-error' }); }
          break;
        }
        case 'deploy':
          this._onDeploy().catch(() => {});
          break;
        case 'open-url':
          if (typeof msg.url === 'string') vscode.env.openExternal(vscode.Uri.parse(msg.url));
          break;
        case 'back':
          await this.sendIdle();
          break;
        default:
          if (this._resolver) {
            const resolve = this._resolver;
            this._resolver = undefined;
            resolve(msg);
          }
      }
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async sendIdle(): Promise<void> {
    const githubToken = await getGitHubToken();
    const renderKey = await getRenderApiKey(this._context.secrets);
    let session: vscode.AuthenticationSession | undefined;
    if (githubToken) {
      try { session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false }); }
      catch { session = undefined; }
    }
    this._post({ command: 'state', screen: 'idle', github: !!githubToken, githubUser: session?.account.label ?? '', render: !!renderKey });
  }

  sendWarnings(issues: { message: string; severity: string }[]): Promise<{ command: string } | undefined> {
    return this.ask({ command: 'state', screen: 'warnings', issues });
  }

  sendProgress(steps: DeployStep[]): void { this._post({ command: 'state', screen: 'progress', steps }); }
  updateStep(index: number, status: DeployStep['status'], label?: string): void { this._post({ command: 'update-step', index, status, label }); }
  sendSuccess(url: string, serviceId: string): void { this._post({ command: 'state', screen: 'success', url, serviceId }); }
  sendError(message: string, action?: { label: string; url: string }): void { this._post({ command: 'state', screen: 'error', message, action }); }
  refresh(): void { this.sendIdle(); }

  ask<T>(msg: object): Promise<T | undefined> {
    return new Promise((resolve) => {
      this._resolver = resolve as Resolver;
      this._post(msg);
    });
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _post(msg: unknown): void { this._view?.webview.postMessage(msg); }

  private _shellHtml(): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><style>${this._css()}</style></head><body>${this._html()}<script>${this._script()}</script></body></html>`;
  }

  private _css(): string {
    return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{padding:16px 12px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground)}
.screen{display:none}.screen.active{display:block}
.label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--vscode-descriptionForeground);margin-bottom:8px}
.row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:4px;margin-bottom:6px;border:1px solid var(--vscode-widget-border,#454545);background:var(--vscode-input-background)}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}.dot.on{background:#4ec94e}.dot.off{background:var(--vscode-errorForeground,#f44747)}
.row-name{font-weight:600;font-size:12px;white-space:nowrap}
.row-detail{flex:1;font-size:11px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.link-btn{background:none;border:none;color:var(--vscode-textLink-foreground);cursor:pointer;font-size:11px;padding:0;white-space:nowrap}
.link-btn:hover{text-decoration:underline}
.divider{border:none;border-top:1px solid var(--vscode-widget-border,#454545);margin:14px 0}
.primary{width:100%;padding:8px 0;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;font-size:13px;font-weight:600;font-family:var(--vscode-font-family);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}
.primary:disabled{opacity:.45;cursor:not-allowed}
.secondary{width:100%;padding:6px 0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:3px;font-size:12px;font-family:var(--vscode-font-family);cursor:pointer;margin-top:6px}
.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
.hint{margin-top:8px;font-size:11px;color:var(--vscode-descriptionForeground);text-align:center}
.step-list{list-style:none;margin-bottom:4px}
.step{display:flex;align-items:flex-start;gap:10px;padding:4px 0;font-size:12px}
.step-icon{width:16px;text-align:center;flex-shrink:0;margin-top:1px}
.step.done .step-icon{color:#4ec94e}.step.error .step-icon{color:var(--vscode-errorForeground)}
.step.active{font-weight:600}.step.pending{color:var(--vscode-descriptionForeground)}
.step-label{flex:1;word-break:break-word}
@keyframes spin{to{transform:rotate(360deg)}}.spin{display:inline-block;animation:spin 1s linear infinite}
.type-list{list-style:none}
.type-item{padding:8px 10px;border-radius:4px;cursor:pointer;margin-bottom:4px;border:1px solid var(--vscode-widget-border,#454545);background:var(--vscode-input-background)}
.type-item:hover{background:var(--vscode-list-hoverBackground)}
.type-name{font-size:12px;font-weight:600}.type-desc{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px}
.file-list{list-style:none;margin-bottom:10px;max-height:90px;overflow-y:auto}
.file-item{font-size:11px;color:var(--vscode-descriptionForeground);padding:1px 0}
.file-item::before{content:'• '}
.text-input{width:100%;padding:6px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#454545);border-radius:3px;font-family:var(--vscode-font-family);font-size:12px;margin-bottom:8px;outline:none}
.text-input:focus{border-color:var(--vscode-focusBorder)}
.password-row{position:relative;margin-bottom:8px}
.password-row .text-input{margin-bottom:0;padding-right:36px}
.show-btn{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:11px;padding:0}
.success-check{font-size:36px;text-align:center;color:#4ec94e;margin-bottom:6px}
.success-url{word-break:break-all;font-size:11px;color:var(--vscode-textLink-foreground);text-align:center;margin-bottom:12px;cursor:pointer}
.success-url:hover{text-decoration:underline}
.error-icon{font-size:28px;text-align:center;margin-bottom:8px}
.error-msg{font-size:12px;line-height:1.5;margin-bottom:12px;word-break:break-word}
.inline-error{font-size:11px;color:var(--vscode-errorForeground);margin-bottom:6px}
.issue-list{list-style:none;margin-bottom:10px}
.issue-item{font-size:11px;padding:5px 7px;border-radius:3px;margin-bottom:5px;line-height:1.4;border-left:3px solid}
.issue-item.error{background:rgba(244,71,71,.1);border-color:var(--vscode-errorForeground,#f44747);color:var(--vscode-foreground)}
.issue-item.warning{background:rgba(255,200,0,.08);border-color:#e6b800;color:var(--vscode-foreground)}`;
  }

  private _html(): string {
    return `
<div id="screen-idle" class="screen">
  <p class="label">Connections</p>
  <div class="row">
    <span class="dot" id="gh-dot"></span>
    <span class="row-name">GitHub</span>
    <span class="row-detail" id="gh-detail"></span>
    <button class="link-btn" id="gh-btn"></button>
  </div>
  <div class="row">
    <span class="dot" id="rd-dot"></span>
    <span class="row-name">Render</span>
    <span class="row-detail" id="rd-detail"></span>
    <button class="link-btn" id="rd-btn"></button>
    <button class="link-btn" id="rd-remove-btn" style="display:none;color:var(--vscode-errorForeground)">Remove</button>
  </div>
  <hr class="divider"/>
  <button id="deploy-btn" class="primary">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2.5L22 20.5H2L12 2.5Z" fill-opacity="0.5"/><path d="M12 8.5L16.8 17.5H7.2L12 8.5Z"/></svg>
    Deploy to Render
  </button>
  <p id="idle-hint" class="hint"></p>
</div>

<div id="screen-render-key" class="screen">
  <p class="label">Connect Render</p>
  <p style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:10px">
    Find your API key at Render → Account Settings → API Keys.
    <br/><button class="link-btn" onclick="post('open-url',{url:'https://dashboard.render.com/u/settings#api-keys'})">Open Render settings ↗</button>
  </p>
  <p style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:10px">
    Also connect Render to your GitHub (one-time):
    <br/><button class="link-btn" onclick="post('open-url',{url:'https://dashboard.render.com/select-repo?type=web'})">Open Render → select repo ↗</button>
    <br/>then click <strong>Configure account</strong>, select your GitHub username, select <strong>All repositories</strong>, and click <strong>Save</strong>.
  </p>
  <div class="password-row">
    <input id="render-key-input" class="text-input" type="password" placeholder="rnd_…" spellcheck="false" autocomplete="off"/>
    <button class="show-btn" onclick="togglePw()">show</button>
  </div>
  <p id="render-key-error" class="inline-error" style="display:none">Invalid API key — please check and try again.</p>
  <button id="render-save-btn" class="primary" onclick="submitRenderKey()">Save &amp; Connect</button>
  <button class="secondary" onclick="post('back')">Cancel</button>
</div>

<div id="screen-progress" class="screen">
  <p class="label">Deploying</p>
  <ul class="step-list" id="step-list"></ul>
</div>

<div id="screen-pick-type" class="screen">
  <p class="label">Select project type</p>
  <ul class="type-list" id="type-list"></ul>
</div>

<div id="screen-commit" class="screen">
  <p class="label">Commit before deploying</p>
  <ul class="file-list" id="commit-files"></ul>
  <input id="commit-input" class="text-input" type="text" spellcheck="false"/>
  <button id="commit-btn" class="primary">Commit &amp; Deploy</button>
  <button class="secondary" onclick="post('commit-cancelled')">Cancel</button>
</div>

<div id="screen-success" class="screen">
  <div class="success-check">✓</div>
  <p class="label" style="text-align:center;margin-bottom:6px">Deployed!</p>
  <p class="success-url" id="success-url"></p>
  <button id="open-btn" class="primary">Open in Browser</button>
  <button id="dash-btn" class="secondary">Open Render Dashboard</button>
  <button class="secondary" onclick="post('back')">← Back</button>
</div>

<div id="screen-pick-plan" class="screen">
  <p class="label">Select your Render plan</p>
  <p style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:10px">Your plan will be remembered for future deploys.</p>
  <ul class="type-list" id="plan-list"></ul>
</div>

<div id="screen-warnings" class="screen">
  <p class="label">Potential issues detected</p>
  <ul class="issue-list" id="issue-list"></ul>
  <button id="deploy-anyway-btn" class="primary" style="margin-top:4px">Deploy anyway</button>
  <button class="secondary" onclick="post('warnings-cancelled')">Cancel</button>
</div>

<div id="screen-error" class="screen">
  <div class="error-icon">✗</div>
  <p class="error-msg" id="error-msg"></p>
  <button id="error-action-btn" class="primary" style="display:none"></button>
  <button class="secondary" onclick="post('back')">← Back</button>
</div>`;
  }

  private _script(): string {
    const projectTypes = JSON.stringify(PROJECT_TYPES.map(t => ({ label: t.label, desc: t.desc })));
    return `
const vscode = acquireVsCodeApi();
const ICONS = { pending:'○', active:'⟳', done:'✓', error:'✗' };
const PROJECT_TYPES = ${projectTypes};
const PLANS = [
  { value:'free',     label:'Free',     desc:'Spins down after 15min inactivity' },
  { value:'starter',  label:'Starter',  desc:'$7/month — always on' },
  { value:'standard', label:'Standard', desc:'$25/month' },
  { value:'pro',      label:'Pro',      desc:'$85/month' },
];

function post(cmd, extra) { vscode.postMessage({ command: cmd, ...extra }); }
function show(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function makeTypeItem(label, desc, onclick) {
  const li = document.createElement('li');
  li.className = 'type-item';
  li.innerHTML = '<div class="type-name">' + label + '</div><div class="type-desc">' + desc + '</div>';
  li.onclick = onclick;
  return li;
}

// ── Idle ──
document.getElementById('rd-btn').onclick = () => show('screen-render-key');
document.getElementById('rd-remove-btn').onclick = () => post('remove-render-key');
document.getElementById('deploy-btn').onclick = () => post('deploy');

// ── Render key ──
function togglePw() {
  const inp = document.getElementById('render-key-input');
  const btn = document.querySelector('.show-btn');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? 'show' : 'hide';
}
function submitRenderKey() {
  const key = document.getElementById('render-key-input').value.trim();
  if (key) post('render-key-submit', { key });
}
document.getElementById('render-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitRenderKey(); });

// ── Plan list ──
PLANS.forEach(({ value, label, desc }) =>
  document.getElementById('plan-list').appendChild(makeTypeItem(label, desc, () => post('plan-selected', { plan: value })))
);

// ── Project type list ──
PROJECT_TYPES.forEach(({ label, desc }) =>
  document.getElementById('type-list').appendChild(makeTypeItem(label, desc, () => post('project-type-selected', { label })))
);

// ── Commit ──
document.getElementById('commit-btn').onclick = () => {
  const msg = document.getElementById('commit-input').value.trim();
  if (msg) post('commit-confirmed', { message: msg });
};
document.getElementById('commit-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('commit-btn').click(); });

// ── Message handler ──
window.addEventListener('message', ({ data }) => {
  if (data.command === 'state') {
    const s = data;
    switch (s.screen) {
      case 'idle': {
        const ghOn = s.github, rdOn = s.render;
        document.getElementById('gh-dot').className = 'dot ' + (ghOn ? 'on' : 'off');
        document.getElementById('gh-detail').textContent = ghOn ? (s.githubUser ? '@' + s.githubUser : 'Connected') : 'Not connected';
        const ghBtn = document.getElementById('gh-btn');
        if (ghOn) {
          ghBtn.textContent = 'Reconnect';
          ghBtn.onclick = () => post('reconnect-github');
        } else {
          ghBtn.textContent = 'Connect';
          ghBtn.onclick = () => post('connect-github');
        }
        document.getElementById('rd-dot').className = 'dot ' + (rdOn ? 'on' : 'off');
        document.getElementById('rd-detail').textContent = rdOn ? 'API key saved' : 'Not connected';
        document.getElementById('rd-btn').textContent = rdOn ? 'Update key' : 'Connect';
        document.getElementById('rd-remove-btn').style.display = rdOn ? '' : 'none';
        document.getElementById('deploy-btn').disabled = !(ghOn && rdOn);
        document.getElementById('idle-hint').textContent = (ghOn && rdOn) ? '' : 'Connect both accounts to deploy.';
        document.getElementById('render-key-input').value = '';
        document.getElementById('render-key-error').style.display = 'none';
        show('screen-idle');
        break;
      }
      case 'progress': {
        const list = document.getElementById('step-list');
        list.innerHTML = '';
        s.steps.forEach((step, i) => {
          const li = document.createElement('li');
          li.className = 'step ' + step.status;
          li.id = 'step-' + i;
          const spin = step.status === 'active' ? ' spin' : '';
          li.innerHTML = '<span class="step-icon' + spin + '">' + (ICONS[step.status] ?? '○') + '</span><span class="step-label">' + step.label + '</span>';
          list.appendChild(li);
        });
        show('screen-progress');
        break;
      }
      case 'pick-project-type': show('screen-pick-type'); break;
      case 'pick-plan': show('screen-pick-plan'); break;
      case 'ask-commit': {
        const fileList = document.getElementById('commit-files');
        fileList.innerHTML = '';
        (s.files || []).forEach(f => { const li = document.createElement('li'); li.className = 'file-item'; li.textContent = f; fileList.appendChild(li); });
        const inp = document.getElementById('commit-input');
        inp.value = s.defaultMsg || '';
        show('screen-commit');
        setTimeout(() => { inp.focus(); inp.select(); }, 50);
        break;
      }
      case 'success': {
        document.getElementById('success-url').textContent = s.url;
        document.getElementById('open-btn').onclick = () => post('open-url', { url: s.url });
        document.getElementById('dash-btn').onclick = () => post('open-url', { url: 'https://dashboard.render.com/web/' + s.serviceId });
        show('screen-success');
        break;
      }
      case 'warnings': {
        const list = document.getElementById('issue-list');
        list.innerHTML = '';
        (s.issues || []).forEach(issue => {
          const li = document.createElement('li');
          li.className = 'issue-item ' + (issue.severity === 'error' ? 'error' : 'warning');
          li.textContent = (issue.severity === 'error' ? '✗ ' : '⚠ ') + issue.message;
          list.appendChild(li);
        });
        document.getElementById('deploy-anyway-btn').onclick = () => post('warnings-confirmed');
        show('screen-warnings');
        break;
      }
      case 'error': {
        document.getElementById('error-msg').textContent = s.message;
        const btn = document.getElementById('error-action-btn');
        if (s.action) { btn.style.display = ''; btn.textContent = s.action.label; btn.onclick = () => post('open-url', { url: s.action.url }); }
        else { btn.style.display = 'none'; }
        show('screen-error');
        break;
      }
    }
  } else if (data.command === 'update-step') {
    const el = document.getElementById('step-' + data.index);
    if (!el) return;
    el.className = 'step ' + data.status;
    const icon = el.querySelector('.step-icon');
    if (icon) { icon.className = 'step-icon' + (data.status === 'active' ? ' spin' : ''); icon.textContent = ICONS[data.status] ?? '○'; }
    if (data.label) { const lbl = el.querySelector('.step-label'); if (lbl) lbl.textContent = data.label; }
  } else if (data.command === 'render-key-validating') {
    const btn = document.getElementById('render-save-btn');
    btn.disabled = true; btn.textContent = 'Validating…';
    document.getElementById('render-key-error').style.display = 'none';
  } else if (data.command === 'render-key-error') {
    const btn = document.getElementById('render-save-btn');
    btn.disabled = false; btn.textContent = 'Save & Connect';
    document.getElementById('render-key-error').style.display = '';
  }
});

post('ready');`;
  }
}
