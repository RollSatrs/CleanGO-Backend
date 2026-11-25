import {describe,it,expect} from "vitest";
import {retryDelayMs,isPermanentFailure,MAX_ATTEMPTS} from "./outbox-rules.js";
describe("notification retry policy",()=>{
 it("backs off and honors retry-after",()=>{expect(retryDelayMs(1)).toBe(15000);expect(retryDelayMs(2)).toBe(30000);expect(retryDelayMs(1,90)).toBe(90000);expect(MAX_ATTEMPTS).toBe(6);});
 it("does not retry invalid recipients indefinitely",()=>{expect(isPermanentFailure(403)).toBe(true);expect(isPermanentFailure(429)).toBe(false);expect(isPermanentFailure(503)).toBe(false);});
});
