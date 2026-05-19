import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const YAHOO_SCRIPT = join(__dirname, "../../yahoo_fetch.py");
export async function fetchPrices(symbols, period = "60d") {
    const request = { symbols, period };
    return new Promise((resolve, reject) => {
        const child = spawn("python3", [YAHOO_SCRIPT], {
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
            stdout += d.toString();
        });
        child.stderr.on("data", (d) => {
            stderr += d.toString();
        });
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `yahoo_fetch.py exited with code ${code}`));
                return;
            }
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            }
            catch {
                reject(new Error(`Failed to parse yahoo_fetch.py output: ${stdout.slice(0, 100)}`));
            }
        });
        child.on("error", (err) => {
            reject(new Error(`Failed to start python3: ${err.message}`));
        });
        child.stdin.write(JSON.stringify(request));
        child.stdin.end();
    });
}
