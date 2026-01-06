#!/usr/bin/env node

/**
 * Generate manifest.json for the benchmark dashboard.
 *
 * This script scans the data directory and creates a manifest file
 * listing all available tasks and runs.
 *
 * Usage: node generate-manifest.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

function scanDataDirectory() {
    const manifest = {
        generatedAt: new Date().toISOString(),
        difficulties: {}
    };

    const difficulties = ['easy', 'medium', 'hard'];

    for (const difficulty of difficulties) {
        const difficultyPath = path.join(DATA_DIR, difficulty);

        if (!fs.existsSync(difficultyPath)) {
            continue;
        }

        manifest.difficulties[difficulty] = {};

        // Get all task directories
        const taskDirs = fs.readdirSync(difficultyPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const taskName of taskDirs) {
            const taskPath = path.join(difficultyPath, taskName);
            const runs = {};

            // Check for run_1 and run_2
            for (const runName of ['run_1', 'run_2']) {
                const runPath = path.join(taskPath, runName);

                if (fs.existsSync(runPath)) {
                    const runInfo = {
                        exists: true,
                        hasReward: fs.existsSync(path.join(runPath, 'reward.txt')),
                        hasQuantitative: fs.existsSync(path.join(runPath, 'analysis-quantitative.json')),
                        hasLLMJudge: fs.existsSync(path.join(runPath, 'analysis-llm-judge.md'))
                    };
                    runs[runName] = runInfo;
                }
            }

            if (Object.keys(runs).length > 0) {
                manifest.difficulties[difficulty][taskName] = runs;
            }
        }
    }

    return manifest;
}

function main() {
    console.log('Scanning data directory...');

    if (!fs.existsSync(DATA_DIR)) {
        console.error(`Data directory not found: ${DATA_DIR}`);
        process.exit(1);
    }

    const manifest = scanDataDirectory();

    // Count tasks
    let totalTasks = 0;
    for (const difficulty of Object.keys(manifest.difficulties)) {
        const taskCount = Object.keys(manifest.difficulties[difficulty]).length;
        totalTasks += taskCount;
        console.log(`  ${difficulty}: ${taskCount} tasks`);
    }

    console.log(`Total: ${totalTasks} tasks`);

    // Write manifest
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest written to: ${MANIFEST_PATH}`);
}

main();
