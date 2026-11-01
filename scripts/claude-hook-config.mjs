import path from 'node:path';
export function claudeHookConfig(root,executable){
  const hook={type:'command',command:executable,args:[path.join(root,'scripts/claude-hook.mjs')]};
  return {
    PostToolUse:[{matcher:'^mcp__cutbridge__(open_workspace|open_project|open_workbench|create_project)$',hooks:[{...hook,timeout:15}]}],
    Stop:[{hooks:[{...hook,asyncRewake:true,timeout:604800}]}],
    SessionEnd:[{hooks:[{...hook,timeout:5}]}],
  };
}
