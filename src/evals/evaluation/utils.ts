import { Message } from '@ank1015/providers';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { SessionTree } from '../../core/session-tree.js';

interface ResultTrace {
    isPass: boolean;
    messages: Message[] | undefined;
    solution: string | undefined;
    testResults: TestResult[] | undefined;
}

interface TestResult {
    results: {
        tool: {
            name: string;
            version: string;
        };
        summary: {
            tests: number,
            passed: number,
            failed: number,
            skipped: number,
            pending: number,
            other: number,
            start: number,
            stop: number,
        }
        tests: {
            name: string;
            status: "failed" | "passed";
            duration: number;
            start: number;
            stop: number;
            retries: number;
            file_path: string;
        }[];
    };
}

export const loadResultTrace: (resultDir: string) => ResultTrace = (resultDir: string) => {
    const sessionFile = join(resultDir, 'session.jsonl');
    const rewardFile = join(resultDir, 'logs', 'reward.txt');
    const solutionFile = join(resultDir, 'solution', 'solve.sh');
    const testResultFile = join(resultDir, 'logs', 'ctrf.json')

    const result : ResultTrace = {
        isPass: false,
        messages: undefined,
        solution: undefined,
        testResults: undefined,
    }

    if (existsSync(sessionFile)) {
        try {
            const session = SessionTree.open(sessionFile);
            result.messages = session.loadMessages();
        } catch (e) {
            console.warn(`Failed to load session from ${resultDir}`, e);
        }
    }

    if (existsSync(rewardFile)) {
        const rewardContent = readFileSync(rewardFile, 'utf-8').trim();
        result.isPass = rewardContent === '1';
    }

    if(existsSync(solutionFile)){
        result.solution = readFileSync(solutionFile, 'utf-8');
    }

    if(existsSync(testResultFile)){
        const testResults = JSON.parse(readFileSync(testResultFile, 'utf-8'));
        result.testResults = testResults;
    }

    return result;

}