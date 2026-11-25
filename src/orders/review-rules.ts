export function validRating(value:unknown):value is number{
 return typeof value==="number"&&Number.isFinite(value)&&value>=.5&&value<=5&&Number.isInteger(value*2);
}
export function normalizedReview(value:unknown):string|null{
 if(value===undefined||value===null)return null;
 if(typeof value!=="string"||value.length>1000)throw new RangeError("Отзыв должен содержать до 1000 символов");
 return value.trim()||null;
}
// A prior influences internal ordering only, not the rating displayed to users.
export function matchingRating(sum:number,count:number):number{
 return (sum+4.2*5)/(count+5);
}
export const reviewReportReasons=["abuse","personal_data","irrelevant","other"] as const;
