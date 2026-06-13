#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up FinSync360 Desktop Agent...\n');

// Check if Node.js version is compatible
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

if (majorVersion < 18) {
  console.error('❌ Node.js 18 or higher is required. Current version:', nodeVersion);
  process.exit(1);
}

console.log('✅ Node.js version check passed:', nodeVersion);

// Install main dependencies
console.log('\n📦 Installing main dependencies...');
try {
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });
  console.log('✅ Main dependencies installed successfully');
} catch (error) {
  console.error('❌ Failed to install main dependencies:', error.message);
  process.exit(1);
}

// Install React dependencies
console.log('\n📦 Installing React dependencies...');
const rendererPath = path.join(__dirname, 'renderer');

if (!fs.existsSync(rendererPath)) {
  console.error('❌ Renderer directory not found');
  process.exit(1);
}

try {
  execSync('npm install', { stdio: 'inherit', cwd: rendererPath });
  console.log('✅ React dependencies installed successfully');
} catch (error) {
  console.error('❌ Failed to install React dependencies:', error.message);
  process.exit(1);
}

// Create necessary directories
console.log('\n📁 Creating necessary directories...');
const directories = [
  path.join(__dirname, 'logs'),
  path.join(__dirname, 'data'),
  path.join(rendererPath, 'dist')
];

directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created directory: ${path.relative(__dirname, dir)}`);
  }
});

// Check for Tally ERP (optional)
console.log('\n🔍 Checking system requirements...');

// Check if running on Windows (Tally ERP is Windows-only)
if (process.platform === 'win32') {
  console.log('✅ Running on Windows - Tally ERP compatible');
} else {
  console.log('⚠️  Not running on Windows - Tally ERP integration may not work');
}

// Create sample configuration
console.log('\n⚙️  Creating sample configuration...');
const configPath = path.join(__dirname, 'config.sample.json');
const sampleConfig = {
  server: {
    url: "ws://localhost:5000/tally-agent",
    apiUrl: "http://localhost:5000/api",
    apiKey: "",
    timeout: 30000
  },
  tally: {
    host: "localhost",
    port: 9000,
    "timeout": 900000,
    "connectTimeoutMs": 20000
  },
  sync: {
    autoSync: false,
    syncInterval: "0 * * * *",
    syncTypes: {
      masters: true,
      parties: true,
      vouchers: true,
      reports: true,
      companies: true
    }
  },
  agent: {
    autoStart: false,
    minimizeToTray: true,
    startMinimized: false,
    logLevel: "info"
  },
  ui: {
    theme: "light",
    notifications: {
      syncComplete: true,
      syncError: true,
      connectionLost: true,
      updates: true
    }
  }
};

if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify(sampleConfig, null, 2));
  console.log('✅ Sample configuration created: config.sample.json');
}

// Display next steps
console.log('\n🎉 Setup completed successfully!\n');
console.log('📋 Next steps:');
console.log('1. Configure your Tally ERP connection in the app settings');
console.log('2. Set up your FinSync360 server URL and API key');
console.log('3. Start development with: npm run dev');
console.log('4. Build for production with: npm run build\n');

console.log('🔧 Available commands:');
console.log('  npm run dev          - Start development server');
console.log('  npm run build        - Build for production');
console.log('  npm run electron:dev - Start Electron in development mode');
console.log('  npm run electron:pack - Package the application');
console.log('  npm run test         - Run tests\n');

console.log('📚 For more information, see README.md');
console.log('🐛 Report issues at: https://github.com/your-repo/issues\n');

console.log('Happy coding! 🚀');
