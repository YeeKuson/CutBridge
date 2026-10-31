import {randomBytes} from 'node:crypto';

export class WorkbenchLinks{
  private tickets=new Map<string,{projectId:string;expires:number}>();
  constructor(private clock=Date.now){}
  private prune(){const now=this.clock();for(const [token,entry] of this.tickets)if(entry.expires<=now)this.tickets.delete(token);}
  issue(origin:string,projectId:string){
    this.prune();const token=randomBytes(24).toString('hex');
    this.tickets.set(token,{projectId,expires:this.clock()+600000});
    const url=`${origin}/?project=${encodeURIComponent(projectId)}#ticket=${token}`;
    return {url,workspaceUrl:url,expiresInSeconds:600};
  }
  projectFor(token:string){this.prune();return this.tickets.get(token)?.projectId;}
}
