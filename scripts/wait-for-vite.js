#!/usr/bin/env node

// Waits for the Vite dev server to be ready before launching Electron.

const http = require('http');

const URL = 'http://localhost:5173';
const MAX_RETRIES = 30;
const INTERVAL = 500;

let retries = 0;

function check() {
  http
    .get(URL, (res) => {
      if (res.statusCode === 200) {
        console.log('Vite dev server is ready.');
        process.exit(0);
      } else {
        retry();
      }
    })
    .on('error', () => {
      retry();
    });
}

function retry() {
  retries++;
  if (retries >= MAX_RETRIES) {
    console.error('Timed out waiting for Vite dev server.');
    process.exit(1);
  }
  setTimeout(check, INTERVAL);
}

check();
