/** Reference data that every environment needs (safe to load in production). */

export interface CitySeed {
  name: string;
  slug: string;
  district: string;
  state: string;
  nameI18n: Record<string, string>;
}

export const CITIES: CitySeed[] = [
  // Kerala
  {
    name: 'Thiruvananthapuram',
    slug: 'thiruvananthapuram',
    district: 'Thiruvananthapuram',
    state: 'Kerala',
    nameI18n: { ml: 'തിരുവനന്തപുരം', hi: 'तिरुवनंतपुरम' },
  },
  {
    name: 'Kollam',
    slug: 'kollam',
    district: 'Kollam',
    state: 'Kerala',
    nameI18n: { ml: 'കൊല്ലം', hi: 'कोल्लम' },
  },
  {
    name: 'Alappuzha',
    slug: 'alappuzha',
    district: 'Alappuzha',
    state: 'Kerala',
    nameI18n: { ml: 'ആലപ്പുഴ', hi: 'अलप्पुझा' },
  },
  {
    name: 'Kottayam',
    slug: 'kottayam',
    district: 'Kottayam',
    state: 'Kerala',
    nameI18n: { ml: 'കോട്ടയം', hi: 'कोट्टयम' },
  },
  {
    name: 'Kochi',
    slug: 'kochi',
    district: 'Ernakulam',
    state: 'Kerala',
    nameI18n: { ml: 'കൊച്ചി', hi: 'कोच्चि' },
  },
  {
    name: 'Thrissur',
    slug: 'thrissur',
    district: 'Thrissur',
    state: 'Kerala',
    nameI18n: { ml: 'തൃശ്ശൂർ', hi: 'त्रिशूर' },
  },
  {
    name: 'Palakkad',
    slug: 'palakkad',
    district: 'Palakkad',
    state: 'Kerala',
    nameI18n: { ml: 'പാലക്കാട്', hi: 'पालक्काड' },
  },
  {
    name: 'Malappuram',
    slug: 'malappuram',
    district: 'Malappuram',
    state: 'Kerala',
    nameI18n: { ml: 'മലപ്പുറം', hi: 'मलप्पुरम' },
  },
  {
    name: 'Kozhikode',
    slug: 'kozhikode',
    district: 'Kozhikode',
    state: 'Kerala',
    nameI18n: { ml: 'കോഴിക്കോട്', hi: 'कोझिकोड' },
  },
  {
    name: 'Kannur',
    slug: 'kannur',
    district: 'Kannur',
    state: 'Kerala',
    nameI18n: { ml: 'കണ്ണൂർ', hi: 'कन्नूर' },
  },
  {
    name: 'Pathanamthitta',
    slug: 'pathanamthitta',
    district: 'Pathanamthitta',
    state: 'Kerala',
    nameI18n: { ml: 'പത്തനംതിട്ട', hi: 'पतनमतिट्टा' },
  },
  {
    name: 'Idukki',
    slug: 'idukki',
    district: 'Idukki',
    state: 'Kerala',
    nameI18n: { ml: 'ഇടുക്കി', hi: 'इडुक्की' },
  },
  {
    name: 'Wayanad',
    slug: 'wayanad',
    district: 'Wayanad',
    state: 'Kerala',
    nameI18n: { ml: 'വയനാട്', hi: 'वायनाड' },
  },
  {
    name: 'Kasaragod',
    slug: 'kasaragod',
    district: 'Kasaragod',
    state: 'Kerala',
    nameI18n: { ml: 'കാസർഗോഡ്', hi: 'कासरगोड' },
  },
  // Tamil Nadu
  {
    name: 'Chennai',
    slug: 'chennai',
    district: 'Chennai',
    state: 'Tamil Nadu',
    nameI18n: { hi: 'चेन्नई' },
  },
  {
    name: 'Coimbatore',
    slug: 'coimbatore',
    district: 'Coimbatore',
    state: 'Tamil Nadu',
    nameI18n: { hi: 'कोयंबटूर' },
  },
  {
    name: 'Madurai',
    slug: 'madurai',
    district: 'Madurai',
    state: 'Tamil Nadu',
    nameI18n: { hi: 'मदुरै' },
  },
  {
    name: 'Tiruchirappalli',
    slug: 'tiruchirappalli',
    district: 'Tiruchirappalli',
    state: 'Tamil Nadu',
    nameI18n: { hi: 'तिरुचिरापल्ली' },
  },
  // Karnataka
  {
    name: 'Bengaluru',
    slug: 'bengaluru',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    nameI18n: { hi: 'बेंगलुरु' },
  },
  {
    name: 'Mysuru',
    slug: 'mysuru',
    district: 'Mysuru',
    state: 'Karnataka',
    nameI18n: { hi: 'मैसूरु' },
  },
  {
    name: 'Mangaluru',
    slug: 'mangaluru',
    district: 'Dakshina Kannada',
    state: 'Karnataka',
    nameI18n: { hi: 'मंगलुरु' },
  },
];

export interface AmenitySeed {
  code: string;
  name: string;
  icon: string;
  nameI18n: Record<string, string>;
}

export const AMENITIES: AmenitySeed[] = [
  {
    code: 'air_conditioning',
    name: 'Air conditioning',
    icon: 'ac',
    nameI18n: { ml: 'എയർ കണ്ടീഷനിംഗ്', hi: 'एयर कंडीशनिंग' },
  },
  {
    code: 'dining_hall',
    name: 'Dining hall',
    icon: 'dining',
    nameI18n: { ml: 'ഭക്ഷണ ഹാൾ', hi: 'भोजन कक्ष' },
  },
  { code: 'stage', name: 'Stage', icon: 'stage', nameI18n: { ml: 'സ്റ്റേജ്', hi: 'मंच' } },
  {
    code: 'bridal_room',
    name: 'Bridal room',
    icon: 'bride',
    nameI18n: { ml: 'വധുവിന്റെ മുറി', hi: 'दुल्हन कक्ष' },
  },
  {
    code: 'groom_room',
    name: 'Groom room',
    icon: 'groom',
    nameI18n: { ml: 'വരന്റെ മുറി', hi: 'दूल्हा कक्ष' },
  },
  {
    code: 'car_parking',
    name: 'Car parking',
    icon: 'parking',
    nameI18n: { ml: 'കാർ പാർക്കിംഗ്', hi: 'कार पार्किंग' },
  },
  {
    code: 'power_backup',
    name: 'Power backup',
    icon: 'generator',
    nameI18n: { ml: 'പവർ ബാക്കപ്പ്', hi: 'पावर बैकअप' },
  },
  { code: 'lift', name: 'Lift', icon: 'lift', nameI18n: { ml: 'ലിഫ്റ്റ്', hi: 'लिफ्ट' } },
  {
    code: 'wheelchair_access',
    name: 'Wheelchair access',
    icon: 'accessible',
    nameI18n: { ml: 'വീൽചെയർ പ്രവേശനം', hi: 'व्हीलचेयर पहुंच' },
  },
  {
    code: 'sound_system',
    name: 'Sound system',
    icon: 'speaker',
    nameI18n: { ml: 'സൗണ്ട് സിസ്റ്റം', hi: 'साउंड सिस्टम' },
  },
  {
    code: 'projector',
    name: 'Projector and screen',
    icon: 'projector',
    nameI18n: { ml: 'പ്രൊജക്ടർ', hi: 'प्रोजेक्टर' },
  },
  {
    code: 'kitchen',
    name: 'Kitchen for caterers',
    icon: 'kitchen',
    nameI18n: { ml: 'അടുക്കള', hi: 'रसोई' },
  },
  {
    code: 'guest_rooms',
    name: 'Guest rooms',
    icon: 'bed',
    nameI18n: { ml: 'അതിഥി മുറികൾ', hi: 'अतिथि कक्ष' },
  },
  {
    code: 'cctv',
    name: 'CCTV security',
    icon: 'camera',
    nameI18n: { ml: 'സിസിടിവി', hi: 'सीसीटीवी' },
  },
  { code: 'wifi', name: 'Wi-Fi', icon: 'wifi', nameI18n: { ml: 'വൈ-ഫൈ', hi: 'वाई-फाई' } },
  {
    code: 'valet_parking',
    name: 'Valet parking',
    icon: 'valet',
    nameI18n: { ml: 'വാലെറ്റ് പാർക്കിംഗ്', hi: 'वैले पार्किंग' },
  },
];

/** Platform settings defaults. Rates in basis points (1 bp = 0.01%), amounts in paise. */
export const PLATFORM_SETTINGS: Record<string, unknown> = {
  commission_bps: 800,
  platform_fee_paise: 49900,
  gst_bps: 1800,
  hold_minutes: 10,
  owner_response_hours: 24,
};
