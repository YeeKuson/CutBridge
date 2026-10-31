import {DomainError} from './model';

// Bound validation work before Zod walks every invalid collection item.
// These limits exceed every supported request (including 1,000 captions).
export function assertInputBudget(input:unknown){
  const pending:[unknown,number][]=[[input,0]];let visited=0;
  while(pending.length){
    const [value,depth]=pending.pop()!;
    if(++visited>20000||depth>32)throw new DomainError('INPUT_TOO_COMPLEX','请求内容过于复杂，请拆分成较小的修改。',413);
    if(value&&typeof value==='object'){
      const length=Array.isArray(value)?value.length:Object.keys(value).length;
      if(length>1000)throw new DomainError('INPUT_TOO_COMPLEX','单个请求集合超过 1000 项，请分批提交。',413);
      for(const child of Object.values(value))pending.push([child,depth+1]);
    }
  }
}
