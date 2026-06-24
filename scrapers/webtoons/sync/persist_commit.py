import sys, os, urllib.parse, subprocess

def _env_from_url():
    db_url = os.environ.get('SUPABASE_DATABASE_URL', '')
    if not db_url:
        return None
    p = urllib.parse.urlparse(db_url)
    env = os.environ.copy()
    env['PGHOST'] = p.hostname or ''
    env['PGPORT'] = str(p.port or 5432)
    env['PGDATABASE'] = p.path.lstrip('/')
    env['PGUSER'] = p.username or ''
    env['PGPASSWORD'] = p.password or ''
    return env

def cmd_write(sha):
    env = _env_from_url()
    if not env or not sha:
        return
    sql = f"""
        INSERT INTO keiyoushi_state (key, value, updated_at)
        VALUES ('last_checked_commit', '{sha}', NOW())
        ON CONFLICT (key) DO UPDATE SET value = '{sha}', updated_at = NOW()
    """
    r = subprocess.run(['psql', '-c', sql, '-t', '-A'], env=env, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"Warning: Supabase persist failed ({r.returncode}): {r.stderr.strip()}", file=sys.stderr)

def cmd_read():
    env = _env_from_url()
    if not env:
        return ''
    r = subprocess.run(['psql', '-c', "SELECT value FROM keiyoushi_state WHERE key='last_checked_commit'", '-t', '-A'], env=env, capture_output=True, text=True)
    if r.returncode == 0:
        return r.stdout.strip()
    return ''

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(0)
    op = sys.argv[1]
    if op == 'write':
        cmd_write(sys.argv[2] if len(sys.argv) > 2 else '')
    elif op == 'read':
        val = cmd_read()
        if val:
            print(val)
