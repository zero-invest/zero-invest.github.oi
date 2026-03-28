#!/usr/bin/env node
/**
 * Poll Cloudflare Pages deployment to detect when training metrics are live
 * Checks every 30 seconds, times out after 10 minutes
 */

import https from 'node:https';

const DEPLOYMENT_URL = 'https://premium.leo2026.cloud';
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const TIMEOUT_MS = 10 * 60_000; // 10 minutes
const MAX_ATTEMPTS = Math.floor(TIMEOUT_MS / POLL_INTERVAL_MS);

console.log('========================================');
console.log('  Cloudflare Pages Deployment Monitor');
console.log('========================================');
console.log(`Target: ${DEPLOYMENT_URL}`);
console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`Timeout: ${TIMEOUT_MS / 1000}s (${MAX_ATTEMPTS} attempts)`);
console.log('');

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function checkTrainingMetrics() {
  try {
    // Check if Worker API has training metrics
    const metricsUrl = 'https://lof-premium-rate-web-api.987144016.workers.dev/api/training/metrics';
    const metrics = await fetchJSON(metricsUrl);
    
    if (!metrics.ok || !metrics.metrics) {
      throw new Error('Worker API not returning training metrics');
    }
    
    const trainedCount = metrics.metrics.filter(m => m.maeValidation30Robust > 0).length;
    const calibratedCount = metrics.metrics.filter(m => m.maeValidation30 && !m.maeValidation30Robust).length;
    
    return {
      workerReady: true,
      totalMetrics: metrics.metrics.length,
      trainedCount,
      calibratedCount,
      message: `Worker API ready: ${trainedCount} trained, ${calibratedCount} calibrated`
    };
  } catch (error) {
    return {
      workerReady: false,
      error: error.message
    };
  }
}

async function checkFrontend() {
  try {
    // Check if frontend is accessible
    return new Promise((resolve) => {
      https.get(DEPLOYMENT_URL, { timeout: 10000 }, (res) => {
        resolve({
          frontendReady: res.statusCode === 200,
          statusCode: res.statusCode
        });
      }).on('error', (e) => {
        resolve({
          frontendReady: false,
          error: e.message
        });
      });
    });
  } catch {
    return { frontendReady: false };
  }
}

async function main() {
  const startTime = Date.now();
  let attempt = 0;
  
  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    console.log(`[${attempt}/${MAX_ATTEMPTS}] Checking deployment... (${elapsed}s elapsed)`);
    
    const [workerStatus, frontendStatus] = await Promise.all([
      checkTrainingMetrics(),
      checkFrontend()
    ]);
    
    if (workerStatus.workerReady) {
      console.log('✅ ' + workerStatus.message);
    } else {
      console.log('⏳ Worker API: ' + (workerStatus.error || 'not ready'));
    }
    
    if (frontendStatus.frontendReady) {
      console.log('✅ Frontend: accessible (HTTP ' + frontendStatus.statusCode + ')');
    } else {
      console.log('⏳ Frontend: ' + (frontendStatus.error || 'not accessible'));
    }
    
    // Check if deployment is complete
    if (workerStatus.workerReady && frontendStatus.frontendReady) {
      console.log('');
      console.log('========================================');
      console.log('  ✅ DEPLOYMENT COMPLETE!');
      console.log('========================================');
      console.log('');
      console.log('Training metrics are now live on Cloudflare Pages');
      console.log(`Total: ${workerStatus.totalMetrics} funds`);
      console.log(`Trained: ${workerStatus.trainedCount} funds`);
      console.log(`Calibrated: ${workerStatus.calibratedCount} funds`);
      console.log('');
      console.log('Visit: https://premium.leo2026.cloud');
      console.log('');
      return;
    }
    
    console.log('');
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  
  console.log('');
  console.log('========================================');
  console.log('  ❌ TIMEOUT - Deployment may have failed');
  console.log('========================================');
  console.log('');
  console.log('Check GitHub Actions: https://github.com/987144016/lof-Premium-Rate-Web/actions');
  console.log('');
  process.exit(1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
