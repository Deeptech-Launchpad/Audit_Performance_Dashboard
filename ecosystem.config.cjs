// PM2 start file for the server (Linux). Only this app is affected: its own name, its own port, its own folder.
//   pm2 start ecosystem.config.cjs      (first time)      pm2 restart audit-dashboard --update-env   (after an update)
// The app listens on 127.0.0.1 only; nginx in front makes it reachable (see docs/DEPLOY.md).
module.exports = {
  apps: [{
    name: 'audit-dashboard',
    script: 'server/src/index.js',
    cwd: __dirname,
    node_args: '--disable-warning=ExperimentalWarning',
    instances: 1,               // one process: the SQLite database and the weekly-report timer must not run twice
    autorestart: true,
    max_memory_restart: '700M',
    env: {
      NODE_ENV: 'production',
      PORT: '3110',
      HOST: '127.0.0.1',
      TRUST_PROXY: '1',
      COOKIE_SECURE: '0',       // set to '1' once the site is opened over https (domain + certificate)
    },
  }],
};
