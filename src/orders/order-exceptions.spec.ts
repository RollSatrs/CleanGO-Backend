import {describe,it,expect} from "vitest";
import {allowedException,needsWait,waitElapsed} from "./order-exceptions.js";
describe("order exception rules",()=>{
 it("allows client cancellation before work only",()=>{
  for(const status of ["pending","accepted","en_route","arrived","replacement_pending"])expect(allowedException("client",status,"cancel","changed_plans")).toBe(true);
  for(const status of ["in_progress","pending_confirmation","completed","disputed","cancelled"])expect(allowedException("client",status,"cancel","changed_plans")).toBe(false);
  expect(allowedException("cleaner","accepted","cancel","wrong_address")).toBe(false);
 });
 it("allows replacement only before arrival or after release",()=>{
  expect(allowedException("cleaner","accepted","release","illness")).toBe(true);
  expect(allowedException("client","replacement_pending","replacement","changed_plans")).toBe(true);
  expect(allowedException("client","en_route","replacement","cleaner_delay")).toBe(true);
  expect(allowedException("client","in_progress","replacement","cleaner_delay")).toBe(false);
  expect(allowedException("cleaner","in_progress","release","illness")).toBe(false);
 });
 it("allows reporting problems without canceling completed work",()=>{
  expect(allowedException("client","completed","issue","quality")).toBe(true);
  expect(allowedException("cleaner","in_progress","issue","unsafe")).toBe(true);
  expect(allowedException("client","arrived","issue","client_absent")).toBe(false);
 });
 it("enforces ten minutes for no-show, not unsafe conditions",()=>{
  const start=new Date("2026-11-24T10:00:00Z");
  expect(needsWait("client_absent")).toBe(true);
  expect(needsWait("unsafe")).toBe(false);
  expect(waitElapsed(null,new Date(start.getTime()+600000))).toBe(false);
  expect(waitElapsed(start,new Date(start.getTime()+599999))).toBe(false);
  expect(waitElapsed(start,new Date(start.getTime()+600000))).toBe(true);
  expect(allowedException("cleaner","arrived","wait","client_absent")).toBe(true);
  expect(allowedException("cleaner","en_route","wait","client_absent")).toBe(false);
 });
});
