import {describe,it,expect} from "vitest";
import {validRating,normalizedReview,matchingRating} from "./review-rules.js";
describe("reviews",()=>{
 it("only permits half-star increments",()=>{
  for(let i=1;i<=10;i++)expect(validRating(i/2)).toBe(true);
  for(const x of [0,5.5,4.3,NaN,Infinity,"5",null])expect(validRating(x)).toBe(false);
 });
 it("normalizes optional text and rejects malformed text",()=>{
  expect(normalizedReview("  Хорошо  ")).toBe("Хорошо");expect(normalizedReview(" ")).toBeNull();expect(normalizedReview(null)).toBeNull();
  expect(()=>normalizedReview("x".repeat(1001))).toThrow();expect(()=>normalizedReview(1)).toThrow();
 });
 it("keeps a new cleaner competitive and reduces single-review bias",()=>{
  expect(matchingRating(0,0)).toBeCloseTo(4.2);
  expect(matchingRating(5,1)).toBeLessThan(matchingRating(49,10));
  expect(matchingRating(0.5,1)).toBeGreaterThan(.5);
 });
});
