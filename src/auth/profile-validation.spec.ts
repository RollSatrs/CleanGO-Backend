import { describe, expect, it } from "vitest";
import { validateAvatar, validateProfileName } from "./profile-validation.js";

describe("profile validation",()=>{
  it("normalizes names including Kazakh letters",()=>{
    expect(validateProfileName("  Әлихан  ")).toBe("Әлихан");
    expect(validateProfileName("",true)).toBeNull();
  });
  it("rejects empty required names and markup",()=>{
    for(const name of ["", "<script>", "Name123", "a".repeat(61),null])expect(()=>validateProfileName(name)).toThrow();
  });
  it("allows removing an avatar and rejects malformed or oversized images",()=>{
    expect(validateAvatar(null)).toBeNull();
    for(const avatar of ["https://example.com/avatar.jpg","data:image/svg+xml;base64,AAAA","data:image/jpeg;base64,AAAA","x".repeat(180001)])expect(()=>validateAvatar(avatar)).toThrow();
  });
});
