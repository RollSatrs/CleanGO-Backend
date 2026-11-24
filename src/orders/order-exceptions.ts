export const exceptionActions=["cancel","release","replacement","issue","wait"] as const;
export type ExceptionAction=typeof exceptionActions[number];
export type ExceptionRole="client"|"cleaner";
export const exceptionReasons=["changed_plans","wrong_address","cleaner_delay","cleaner_unreachable","client_absent","client_unreachable","unsafe","illness","equipment","quality","other"] as const;
export const WAIT_MS=10*60_000;
export function allowedException(role:ExceptionRole,status:string,action:ExceptionAction,reason:string){
  if(action==="cancel")return role==="client"&&["pending","accepted","en_route","arrived","replacement_pending"].includes(status);
  if(action==="release")return role==="cleaner"&&["accepted","en_route","arrived"].includes(status);
  if(action==="replacement")return role==="client"&&["accepted","en_route","replacement_pending"].includes(status);
  if(action==="wait")return role==="cleaner"&&status==="arrived";
  if(action==="issue")return ["accepted","en_route","arrived","in_progress","pending_confirmation"].includes(status)||(role==="client"&&status==="completed");
  return false;
}
export function needsWait(reason:string){return ["client_absent","client_unreachable"].includes(reason);}
export function waitElapsed(start:Date|null,now:Date){return !!start&&now.getTime()-start.getTime()>=WAIT_MS;}
