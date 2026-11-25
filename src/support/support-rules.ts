export function isSupportCase(kind:string,reason:string,previousStatus:string){
 return kind==="issue"||kind==="review_report"||(kind==="release"&&["client_absent","client_unreachable"].includes(reason))||(kind==="cancel"&&previousStatus==="arrived");
}
export function canManageSupport(user:{id:string;phoneVerifiedAt:unknown},allowlist:string|undefined){
 return Boolean(user.phoneVerifiedAt&&allowlist?.split(",").map(v=>v.trim().toLowerCase()).filter(Boolean).includes(user.id.toLowerCase()));
}
export const supportActions=["claim","reply","resolve","hide_review","publish_review","cancel_disputed","resume_disputed"] as const;
export type SupportAction=typeof supportActions[number];
