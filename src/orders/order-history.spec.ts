import {describe,it,expect} from "vitest";
import {clientHistoryFilter,cleanerHistoryStatuses} from "./order-history.js";
describe("order history filters",()=>{
 it("keeps pending confirmation and disputes active only",()=>{
   for(const status of ["pending_confirmation","disputed"]){
     expect(clientHistoryFilter("active").statuses).not.toContain(status);
     expect(clientHistoryFilter("archive").statuses).not.toContain(status);
     expect(cleanerHistoryStatuses).toContain(status);
   }
   expect(clientHistoryFilter("active").exclude).toBe(true);
 });
 it("separates completed and unsuccessful orders",()=>{
   const completed=clientHistoryFilter("completed").statuses;
   const cancelled=clientHistoryFilter("cancelled").statuses;
   expect(completed).toEqual(["completed"]);
   expect(cancelled).not.toContain("completed");
   expect(clientHistoryFilter("archive").statuses).toEqual([...completed,...cancelled]);
 });
});
