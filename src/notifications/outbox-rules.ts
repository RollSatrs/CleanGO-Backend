export const MAX_ATTEMPTS=6;
export function retryDelayMs(attempt:number,retryAfterSeconds=0){
 return Math.max(1000,Math.min(30*60_000,15_000*2**Math.max(0,attempt-1)),Math.min(24*60*60_000,Math.max(0,retryAfterSeconds)*1000));
}
export function isPermanentFailure(status:number){return [400,401,403,404].includes(status);}
