import { BadRequestException } from "@nestjs/common";

export function validateProfileName(value: unknown, optional = false): string | null {
  if (typeof value !== "string") throw new BadRequestException("Введите корректное имя");
  const normalized = value.trim().replace(/ +/g, " ").normalize("NFC");
  if (optional && !normalized) return null;
  if (!normalized || normalized.length > 60 || !/^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(normalized))
    throw new BadRequestException("Имя и фамилия: до 60 символов, только буквы, пробелы, дефисы и апострофы");
  return normalized;
}

// Only small JPEG images produced by the client canvas are accepted. Inspect
// the encoded bytes and JPEG dimensions instead of trusting the MIME string.
export function validateAvatar(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 180000)
    throw new BadRequestException("Фотография слишком большая");
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new BadRequestException("Допустим только JPEG");
  const bytes = Buffer.from(match[1], "base64");
  const invalid = () => new BadRequestException("Некорректный JPEG или размер больше 512×512");
  if (bytes.length < 100 || bytes.length > 135000 || bytes.toString("base64") !== match[1] ||
      bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length-2] !== 255 || bytes[bytes.length-1] !== 217) throw invalid();
  let pos=2, validDimensions=false, hasScan=false;
  while(pos<bytes.length-2) {
    if(bytes[pos++]!==255)throw invalid();
    while(bytes[pos]===255)pos++;
    const marker=bytes[pos++];
    if(marker===217)break;
    if(pos+2>bytes.length)throw invalid();
    const length=bytes.readUInt16BE(pos);
    if(length<2 || pos+length>bytes.length)throw invalid();
    if([0xc0,0xc1,0xc2].includes(marker)){
      if(length<8)throw invalid();
      const h=bytes.readUInt16BE(pos+3),w=bytes.readUInt16BE(pos+5);
      if(!h||!w||h>512||w>512)throw invalid();
      validDimensions=true;
    }
    if(marker===0xda){hasScan=true;break;}
    pos+=length;
  }
  if(!validDimensions||!hasScan)throw invalid();
  return value;
}
