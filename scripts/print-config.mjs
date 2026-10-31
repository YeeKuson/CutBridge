import path from 'node:path';
import {fileURLToPath} from 'node:url';
const entry=path.resolve(fileURLToPath(new URL('./mcp.mjs',import.meta.url)));
console.log('Claude Code MCP JSON:\n'+JSON.stringify({mcpServers:{cutbridge:{command:process.execPath,args:[entry],env:{CUTBRIDGE_HOST:'claude'}}}},null,2));
console.log('\nCodex TOML:\n[mcp_servers.cutbridge]\ncommand = '+JSON.stringify(process.execPath)+'\nargs = ['+JSON.stringify(entry)+']\nstartup_timeout_sec = 60\ntool_timeout_sec = 180\nenv_vars = ["CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_APP_TOOLS_PIPE_PATH"]\n[mcp_servers.cutbridge.env]\nCUTBRIDGE_HOST = "codex"');
