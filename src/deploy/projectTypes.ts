import { ProjectType } from './detector';

export interface ProjectTypeDefinition {
  label: string;
  desc: string;
  type: ProjectType;
  buildCommand: string;
  startCommand: string;
  runtime: string;
}

export const PROJECT_TYPES: ProjectTypeDefinition[] = [
  { label: 'React',          desc: 'npm install · npm run build → static', type: 'static', buildCommand: 'npm install && npm run build', startCommand: '',                   runtime: 'static' },
  { label: 'Static website', desc: 'Plain HTML/CSS/JS — no build step',    type: 'static', buildCommand: '',                            startCommand: '',                   runtime: 'static' },
  { label: 'Node.js',        desc: 'npm install · npm start',              type: 'node',   buildCommand: 'npm install',                 startCommand: 'npm start',          runtime: 'node'   },
  { label: 'Python',         desc: 'pip install · gunicorn',               type: 'python', buildCommand: 'pip install -r requirements.txt', startCommand: 'gunicorn app:app', runtime: 'python' },
  { label: 'Go',             desc: 'go build · ./app',                     type: 'go',     buildCommand: 'go build -o app .',           startCommand: './app',              runtime: 'go'     },
];
