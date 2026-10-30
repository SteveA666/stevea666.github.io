// Shared by import and timetable rendering; preserve the existing train/bus API keys.
export function routeMode(route) {
  const raw=route?.route_type;if(raw==null||String(raw).trim()==='')return 'other';
  const type=Number(raw);if(!Number.isInteger(type))return 'other';
  if([0,1,2,5,7,12].includes(type)||(type>=100&&type<200)||(type>=400&&type<700)||(type>=900&&type<1000)||type===1200||(type>=1400&&type<1500))return 'train';
  if([3,11].includes(type)||(type>=200&&type<300)||(type>=700&&type<900))return 'bus';
  return 'other';
}
