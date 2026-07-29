#!/usr/bin/env node

/**
 * Environment Switcher for FinSync360 Mobile App
 * Usage: node switch-environment.js [development|production]
 */

const fs = require('fs');
const path = require('path');

const environments = {
  development: '.env.development',
  office: '.env.office',
  production: '.env.production'
};

function switchEnvironment(targetEnv) {
  if (!environments[targetEnv]) {
    console.error(`❌ Invalid environment: ${targetEnv}`);
    console.log(`Available environments: ${Object.keys(environments).join(', ')}`);
    process.exit(1);
  }

  const sourceFile = path.join(__dirname, environments[targetEnv]);
  const targetFile = path.join(__dirname, '.env');

  if (!fs.existsSync(sourceFile)) {
    console.error(`❌ Environment file not found: ${sourceFile}`);
    process.exit(1);
  }

  try {
    // Copy the environment file
    fs.copyFileSync(sourceFile, targetFile);
    
    console.log(`🔄 Environment switched to: ${targetEnv}`);
    console.log(`📄 Active configuration: ${environments[targetEnv]} → .env`);
    
    // Read and display the active configuration
    const envContent = fs.readFileSync(targetFile, 'utf8');
    const envLines = envContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    
    console.log('\n📋 Active Environment Variables:');
    envLines.forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        // Mask sensitive values
        const maskedValue = ['JWT_SECRET', 'ENCRYPTION_KEY'].includes(key) 
          ? '***MASKED***' 
          : value;
        console.log(`   ${key}=${maskedValue}`);
      }
    });
    
    console.log('\n✅ Environment switch completed successfully!');
    console.log('🔄 Restart your development server to apply changes.');
    
  } catch (error) {
    console.error(`❌ Failed to switch environment: ${error.message}`);
    process.exit(1);
  }
}

function showCurrentEnvironment() {
  const envFile = path.join(__dirname, '.env');
  
  if (!fs.existsSync(envFile)) {
    console.log('❌ No .env file found');
    return;
  }
  
  const envContent = fs.readFileSync(envFile, 'utf8');
  const apiBaseUrl = envContent.match(/API_BASE_URL=(.+)/)?.[1];
  
  if (apiBaseUrl) {
    if (apiBaseUrl.includes('localhost')) {
      console.log('🔧 Current Environment: DEVELOPMENT');
      console.log(`📡 API URL: ${apiBaseUrl}`);
    } else if (apiBaseUrl.includes('herokuapp.com')) {
      console.log('🌐 Current Environment: PRODUCTION');
      console.log(`📡 API URL: ${apiBaseUrl}`);
    } else {
      console.log('❓ Current Environment: UNKNOWN');
      console.log(`📡 API URL: ${apiBaseUrl}`);
    }
  } else {
    console.log('❌ Could not determine current environment');
  }
}

// Main execution
const targetEnv = process.argv[2];

if (!targetEnv) {
  console.log('🔍 FinSync360 Mobile App - Environment Switcher\n');
  showCurrentEnvironment();
  console.log('\n📖 Usage:');
  console.log('  node switch-environment.js development  # Switch to local development');
  console.log('  node switch-environment.js production   # Switch to Heroku production');
  console.log('\n🌍 Available Environments:');
  Object.keys(environments).forEach(env => {
    console.log(`  - ${env}`);
  });
} else {
  switchEnvironment(targetEnv);
}
