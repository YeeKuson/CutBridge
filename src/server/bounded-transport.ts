import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {assertInputBudget} from '../core/input-budget';

export class BoundedStdioTransport extends StdioServerTransport{
  async start(){
    const receive=this.onmessage;
    this.onmessage=message=>{
      try{assertInputBudget(message);}catch(error){
        if('id' in message&&message.id!==undefined)void this.send({jsonrpc:'2.0',id:message.id,error:{code:-32602,message:error instanceof Error?error.message:'Input exceeds limits'}}).catch(()=>{});
        return;
      }
      receive?.(message);
    };
    return super.start();
  }
}
