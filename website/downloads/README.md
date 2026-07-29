# TallyFin installer hosting

Place your built Windows installer here:

```
TallyFin-Desktop-Agent-Setup.exe
```

Build from the repo:

```powershell
cd desktop-agent
npm run electron:dist
```

Copy the output from `desktop-agent/dist/` into this folder, then update `agentDownloadUrl` in `../js/config.js` if you use a different filename.
