// Shared config for the dashboard and its admin panel.
// The password only keeps casual visitors out of the admin screens: its hash
// is public. Saving changes needs a GitHub token, which is the real lock.
const SITE_CONFIG = {
  owner: 'singulairtyinai',
  repo: 'ai-dev-dashboard',
  branch: 'main',
  sourcesPath: 'data/sources.json',
  workflowFile: 'fetch-data.yml',
  alertsWorkflowFile: 'send-alerts.yml',
  passwordHashSHA256: '16536042773ea09b9d2f9db48cec3c8cbd81b143975edaab3f47a18ded589c2c',
};
