#!/usr/bin/env python3
"""
Benchmark and validation script for local LLM inference engines (e.g. llama.cpp server).
Tests:
1. Health & model discovery (/v1/models)
2. Prompt evaluation speed and generation speed (tokens/sec)
3. Code generation quality
4. Tool calling / JSON function-calling schema adherence
5. Generates Markdown summary report (compatible with $GITHUB_STEP_SUMMARY)
"""

import sys
import os
import time
import json
import urllib.request
import urllib.error

API_URL = os.environ.get("LLM_API_URL", "http://127.0.0.1:8080/v1")
API_KEY = os.environ.get("LLM_API_KEY", "local-only")
SUMMARY_FILE = os.environ.get("GITHUB_STEP_SUMMARY")

def request(endpoint, data=None, timeout=300):
    url = f"{API_URL}/{endpoint}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "LLM-Runner-Benchmark/1.0"
        }
    )
    if data is not None:
        req.data = json.dumps(data).encode("utf-8")
    
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def wait_for_ready(max_retries=60, delay=5):
    print(f"Waiting for llama-server readiness at {API_URL}...")
    for i in range(max_retries):
        try:
            res = request("models", timeout=10)
            models = res.get("data", [])
            if models:
                model_id = models[0].get("id", "unknown")
                print(f"Server ready! Loaded model: {model_id} (attempt {i+1})")
                return model_id
        except Exception as e:
            if i % 6 == 0:
                print(f"Waiting for server... ({e})")
            time.sleep(delay)
    raise RuntimeError("Server failed to become ready in time.")

def run_coding_benchmark(model_id):
    print("\n--- Test 1: Coding Generation & Speed ---")
    prompt = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": "You are a concise expert software engineer. Provide only clean code and brief explanation."},
            {"role": "user", "content": "Write a Python function `parse_commit_sha(text: str) -> str | None` that extracts the first 40-character hexadecimal git commit SHA from a text using regex. Include a quick example."}
        ],
        "temperature": 0.1,
        "max_tokens": 300
    }
    
    t0 = time.time()
    res = request("chat/completions", prompt)
    t1 = time.time()
    elapsed = t1 - t0
    
    choice = res["choices"][0]
    content = choice["message"]["content"]
    usage = res.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    tok_per_sec = completion_tokens / elapsed if elapsed > 0 else 0
    
    # Check if a valid 40-hex regex was generated (supporting [a-f0-9], [0-9a-f], [0-9a-fA-F], etc.)
    import re
    valid_code = bool(re.search(r'\[[a-f0-9A-F_-]+\]\{40\}', content) or ("[0-9a-f" in content.lower() and "40" in content))
    
    print(f"Generated tokens: {completion_tokens}")
    print(f"Elapsed: {elapsed:.2f}s")
    print(f"Speed: {tok_per_sec:.2f} tok/s")
    print(f"Valid SHA regex pattern: {'YES' if valid_code else 'NO'}")
    
    return {
        "name": "Code Generation",
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "elapsed": elapsed,
        "tok_per_sec": tok_per_sec,
        "passed": valid_code,
        "output_sample": content[:250] + ("..." if len(content) > 250 else "")
    }

def run_tool_calling_benchmark(model_id):
    print("\n--- Test 2: Structured Tool / Function Calling ---")
    tools = [
        {
            "type": "function",
            "function": {
                "name": "execute_shell",
                "description": "Execute a bash shell command",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "The command line string"}
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "edit_file",
                "description": "Edit lines in a file",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "target": {"type": "string"},
                        "replacement": {"type": "string"}
                    },
                    "required": ["path", "target", "replacement"]
                }
            }
        }
    ]
    
    prompt = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": "You are an automated coding agent. You must invoke tools to perform user requests."},
            {"role": "user", "content": "Please run git status in the repository to check dirty files."}
        ],
        "tools": tools,
        "temperature": 0.0,
        "max_tokens": 200
    }
    
    t0 = time.time()
    res = request("chat/completions", prompt)
    t1 = time.time()
    elapsed = t1 - t0
    
    msg = res["choices"][0]["message"]
    usage = res.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    tok_per_sec = completion_tokens / elapsed if elapsed > 0 else 0
    
    tool_calls = msg.get("tool_calls", [])
    raw_content = msg.get("content", "") or ""
    
    tool_invoked = False
    invoked_name = ""
    invoked_args = ""
    
    if tool_calls:
        tool_invoked = True
        invoked_name = tool_calls[0].get("function", {}).get("name", "")
        invoked_args = tool_calls[0].get("function", {}).get("arguments", "")
    elif "execute_shell" in raw_content or "git status" in raw_content:
        # Fallback if emitted as text/json
        tool_invoked = True
        invoked_name = "execute_shell (raw text/json)"
        invoked_args = raw_content[:100]
        
    print(f"Tool invoked: {tool_invoked} ({invoked_name})")
    print(f"Args: {invoked_args}")
    print(f"Elapsed: {elapsed:.2f}s ({tok_per_sec:.2f} tok/s)")
    
    return {
        "name": "Tool Calling",
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "elapsed": elapsed,
        "tok_per_sec": tok_per_sec,
        "passed": tool_invoked,
        "details": f"{invoked_name}: {invoked_args}"
    }

def run_diff_benchmark(model_id):
    print("\n--- Test 3: Bug Fixing / Unified Diff Reasoning ---")
    buggy_code = """
def calculate_average(scores):
    total = sum(scores)
    return total / len(scores)  # ZeroDivisionError if scores is empty
"""
    prompt = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": "You are a code reviewer. Fix the bug in the provided python function so it returns 0.0 when scores is empty. Output only the fixed function."},
            {"role": "user", "content": f"Fix this function:\n{buggy_code}"}
        ],
        "temperature": 0.0,
        "max_tokens": 200
    }
    
    t0 = time.time()
    res = request("chat/completions", prompt)
    t1 = time.time()
    elapsed = t1 - t0
    
    content = res["choices"][0]["message"]["content"]
    usage = res.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    tok_per_sec = completion_tokens / elapsed if elapsed > 0 else 0
    
    passed = ("if not scores" in content or "if len(scores) == 0" in content or "if scores:" in content) and "0.0" in content or "0" in content
    
    print(f"Elapsed: {elapsed:.2f}s ({tok_per_sec:.2f} tok/s)")
    print(f"Bugfix verified: {'YES' if passed else 'NO'}")
    
    return {
        "name": "Bug Fixing",
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "elapsed": elapsed,
        "tok_per_sec": tok_per_sec,
        "passed": passed,
        "output_sample": content[:250] + ("..." if len(content) > 250 else "")
    }

def write_summary(model_id, results, total_time):
    all_passed = all(r["passed"] for r in results)
    avg_speed = sum(r["tok_per_sec"] for r in results) / len(results) if results else 0
    
    md = []
    md.append(f"# 🧪 LLM Runner Benchmark: `{model_id}`\n")
    md.append(f"**Overall Status:** {'✅ PASSED' if all_passed else '⚠️ WITH WARNINGS'}")
    md.append(f"- **Average Generation Speed:** `{avg_speed:.2f} tokens/s`")
    md.append(f"- **Total Benchmark Duration:** `{total_time:.2f}s`\n")
    
    md.append("| Test Case | Status | Speed (tok/s) | Tokens (Prompt / Compl) | Elapsed |")
    md.append("| :--- | :---: | :---: | :---: | :---: |")
    for r in results:
        status_icon = "✅ Pass" if r["passed"] else "❌ Fail"
        md.append(f"| {r['name']} | {status_icon} | {r['tok_per_sec']:.2f} | {r['prompt_tokens']} / {r['completion_tokens']} | {r['elapsed']:.2f}s |")
    
    md.append("\n### Details & Samples\n")
    for r in results:
        md.append(f"#### {r['name']}")
        if "details" in r:
            md.append(f"```text\n{r['details']}\n```")
        if "output_sample" in r:
            md.append(f"```text\n{r['output_sample']}\n```")
    
    summary_text = "\n".join(md)
    print("\n" + "="*60)
    print(summary_text)
    print("="*60 + "\n")
    
    if SUMMARY_FILE:
        try:
            with open(SUMMARY_FILE, "a", encoding="utf-8") as f:
                f.write(summary_text + "\n")
            print(f"Written summary to {SUMMARY_FILE}")
        except Exception as e:
            print(f"Failed to write to GITHUB_STEP_SUMMARY: {e}")

def main():
    t_start = time.time()
    try:
        model_id = wait_for_ready()
    except Exception as e:
        print(f"Error connecting to llama.cpp server: {e}")
        sys.exit(1)
        
    results = []
    results.append(run_coding_benchmark(model_id))
    results.append(run_tool_calling_benchmark(model_id))
    results.append(run_diff_benchmark(model_id))
    
    total_time = time.time() - t_start
    write_summary(model_id, results, total_time)
    
    # Exit with code 0 if all tests passed, 1 otherwise
    if not all(r["passed"] for r in results):
        print("Warning: some tests failed.")
        sys.exit(1)
    print("All benchmark tests passed successfully!")

if __name__ == "__main__":
    main()

