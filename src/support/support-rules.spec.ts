import {describe,it,expect} from "vitest";
import {isSupportCase,canManageSupport} from "./support-rules.js";
describe("support",()=>{
 it("routes incidents needing review, not ordinary cancellation or timer",()=>{
  expect(isSupportCase("issue","quality","completed")).toBe(true);
  expect(isSupportCase("review_report","abuse","completed")).toBe(true);
  expect(isSupportCase("release","client_absent","arrived")).toBe(true);
  expect(isSupportCase("cancel","changed_plans","arrived")).toBe(true);
  expect(isSupportCase("cancel","changed_plans","pending")).toBe(false);
  expect(isSupportCase("wait","client_absent","arrived")).toBe(false);
 });
 it("defaults to no staff access, and requires verified identity",()=>{
  expect(canManageSupport({id:"abc",phoneVerifiedAt:new Date()},undefined)).toBe(false);
  expect(canManageSupport({id:"abc",phoneVerifiedAt:null},"abc")).toBe(false);
  expect(canManageSupport({id:"abc",phoneVerifiedAt:new Date()}," other, ABC ")).toBe(true);
  expect(canManageSupport({id:"abc",phoneVerifiedAt:new Date()},"abcd")).toBe(false);
 });
});
