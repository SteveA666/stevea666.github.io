// Boarding-location suffixes are presentation details, not station names.
const direction='(?:(?:north|south|east|west|n|s|e|w)[ -]*bound|[nsew]b)';
const boarding='(?:(?:subway|lrt|train|rail|bus)\\s+)?(?:platform|track|bay)(?:\\s+(?!towards?\\b)[\\w-]+)?(?:\\s+towards?\\s+.+)?';
const suffix=new RegExp('(?:\\s*[-–—,:]\\s*|\\s*\\(\\s*|\\s+)(?:'+direction+'(?:\\s+'+boarding+')?|'+boarding+')\\s*\\)?\\s*$','i');

export function stationDisplayName(name) {
  let result=String(name??'').trim(),previous;
  do {
    previous=result;
    const trimmed=result.replace(suffix,'').trim();
    if(trimmed)result=trimmed;
  } while(result!==previous);
  return result;
}
