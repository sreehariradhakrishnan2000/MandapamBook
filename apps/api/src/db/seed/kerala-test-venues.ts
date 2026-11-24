/**
 * Test venues: 10 in each of Kerala's 14 districts (140 in all), for trying search, maps and
 * booking with realistic volume. Loaded only by `pnpm db:seed --kerala`, never in production.
 *
 * The towns, PIN codes and map positions are real, so near-me search and Google Maps links
 * behave as they would for real listings. Every venue, owner and address line is invented,
 * and each description says it is a test listing. Photos are free Unsplash stock images
 * (Unsplash licence) in photos/stock, shared between venues.
 */
import type { SampleAuditorium, SampleHall, SampleOwner } from './sample-data.js';

interface Town {
  locality: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

interface District {
  /** Name of the district. */
  name: string;
  /** City slug in master data that stands for the district (Ernakulam's is Kochi). */
  citySlug: string;
  /** Short key used in owner emails and slugs. */
  key: string;
  towns: Town[];
}

const t = (locality: string, pincode: string, latitude: number, longitude: number): Town => ({
  locality,
  pincode,
  latitude,
  longitude,
});

export const KERALA_DISTRICTS: District[] = [
  {
    name: 'Thiruvananthapuram',
    citySlug: 'thiruvananthapuram',
    key: 'tvm',
    towns: [
      t('Kazhakkoottam', '695582', 8.5686, 76.8731),
      t('Nemom', '695020', 8.456, 76.999),
      t('Neyyattinkara', '695121', 8.4, 77.0857),
      t('Attingal', '695101', 8.696, 76.815),
      t('Varkala', '695141', 8.7379, 76.7163),
      t('Nedumangad', '695541', 8.603, 77.002),
      t('Kovalam', '695527', 8.4004, 76.9787),
      t('Pattom', '695004', 8.5241, 76.942),
      t('Sreekaryam', '695017', 8.548, 76.917),
      t('Balaramapuram', '695501', 8.425, 77.048),
    ],
  },
  {
    name: 'Kollam',
    citySlug: 'kollam',
    key: 'kollam',
    towns: [
      t('Karunagappally', '690518', 9.057, 76.535),
      t('Kottarakkara', '691506', 9.001, 76.773),
      t('Punalur', '691305', 9.017, 76.926),
      t('Chavara', '691583', 8.99, 76.537),
      t('Kundara', '691501', 8.956, 76.679),
      t('Paravur', '691301', 8.816, 76.667),
      t('Chathannoor', '691572', 8.859, 76.718),
      t('Kadakkal', '691536', 8.829, 76.92),
      t('Anchal', '691306', 8.931, 76.905),
      t('Chinnakada', '691001', 8.885, 76.59),
    ],
  },
  {
    name: 'Pathanamthitta',
    citySlug: 'pathanamthitta',
    key: 'pta',
    towns: [
      t('Pathanamthitta Town', '689645', 9.2648, 76.787),
      t('Adoor', '691523', 9.155, 76.735),
      t('Thiruvalla', '689101', 9.383, 76.574),
      t('Ranni', '689672', 9.385, 76.785),
      t('Konni', '689691', 9.228, 76.85),
      t('Kozhencherry', '689641', 9.333, 76.708),
      t('Pandalam', '689501', 9.225, 76.678),
      t('Mallappally', '689585', 9.446, 76.656),
      t('Kumbanad', '689547', 9.356, 76.651),
      t('Elanthoor', '689643', 9.287, 76.738),
    ],
  },
  {
    name: 'Alappuzha',
    citySlug: 'alappuzha',
    key: 'alpy',
    towns: [
      t('Mullakkal', '688011', 9.4981, 76.3388),
      t('Cherthala', '688524', 9.684, 76.336),
      t('Kayamkulam', '690502', 9.174, 76.501),
      t('Haripad', '690514', 9.283, 76.456),
      t('Mavelikkara', '690101', 9.251, 76.552),
      t('Chengannur', '689121', 9.318, 76.611),
      t('Ambalappuzha', '688561', 9.383, 76.364),
      t('Mankombu', '688503', 9.444, 76.436),
      t('Aroor', '688534', 9.872, 76.305),
      t('Mannar', '689622', 9.306, 76.535),
    ],
  },
  {
    name: 'Kottayam',
    citySlug: 'kottayam',
    key: 'ktm',
    towns: [
      t('Nagampadam', '686001', 9.5916, 76.5222),
      t('Changanassery', '686101', 9.444, 76.541),
      t('Pala', '686575', 9.713, 76.683),
      t('Ettumanoor', '686631', 9.67, 76.56),
      t('Vaikom', '686141', 9.749, 76.393),
      t('Kanjirappally', '686507', 9.557, 76.788),
      t('Erattupetta', '686121', 9.687, 76.779),
      t('Pampady', '686502', 9.56, 76.645),
      t('Kumarakom', '686563', 9.617, 76.43),
      t('Mundakayam', '686513', 9.544, 76.884),
    ],
  },
  {
    name: 'Idukki',
    citySlug: 'idukki',
    key: 'idk',
    towns: [
      t('Thodupuzha', '685584', 9.897, 76.714),
      t('Kattappana', '685508', 9.753, 77.118),
      t('Munnar', '685612', 10.0889, 77.0595),
      t('Adimali', '685561', 10.013, 76.957),
      t('Nedumkandam', '685553', 9.838, 77.154),
      t('Kumily', '685509', 9.61, 77.163),
      t('Cheruthoni', '685602', 9.844, 76.974),
      t('Vandiperiyar', '685533', 9.571, 77.09),
      t('Rajakkad', '685566', 9.99, 77.087),
      t('Peermade', '685531', 9.573, 76.979),
    ],
  },
  {
    name: 'Ernakulam',
    citySlug: 'kochi',
    key: 'ekm',
    towns: [
      t('Edappally', '682024', 10.0261, 76.3084),
      t('Kakkanad', '682030', 10.0159, 76.3419),
      t('Aluva', '683101', 10.1076, 76.3516),
      t('Perumbavoor', '683542', 10.115, 76.477),
      t('Angamaly', '683572', 10.196, 76.386),
      t('Muvattupuzha', '686661', 9.989, 76.579),
      t('Kothamangalam', '686691', 10.06, 76.635),
      t('Tripunithura', '682301', 9.945, 76.348),
      t('North Paravur', '683513', 10.15, 76.229),
      t('Vyttila', '682019', 9.968, 76.318),
    ],
  },
  {
    name: 'Thrissur',
    citySlug: 'thrissur',
    key: 'tcr',
    towns: [
      t('Ayyanthole', '680003', 10.527, 76.199),
      t('Guruvayur', '680101', 10.594, 76.041),
      t('Kunnamkulam', '680503', 10.649, 76.07),
      t('Chalakudy', '680307', 10.301, 76.333),
      t('Irinjalakuda', '680121', 10.343, 76.211),
      t('Kodungallur', '680664', 10.232, 76.196),
      t('Wadakkanchery', '680582', 10.662, 76.241),
      t('Chavakkad', '680506', 10.585, 76.02),
      t('Ollur', '680306', 10.473, 76.238),
      t('Mala', '680732', 10.242, 76.267),
    ],
  },
  {
    name: 'Palakkad',
    citySlug: 'palakkad',
    key: 'pkd',
    towns: [
      t('Sultanpet', '678001', 10.776, 76.654),
      t('Ottapalam', '679101', 10.772, 76.377),
      t('Shoranur', '679121', 10.762, 76.272),
      t('Mannarkkad', '678582', 10.992, 76.46),
      t('Chittur', '678101', 10.699, 76.746),
      t('Alathur', '678541', 10.648, 76.538),
      t('Pattambi', '679303', 10.809, 76.197),
      t('Vadakkencherry', '678683', 10.591, 76.48),
      t('Kollengode', '678506', 10.613, 76.691),
      t('Cherpulassery', '679503', 10.878, 76.311),
    ],
  },
  {
    name: 'Malappuram',
    citySlug: 'malappuram',
    key: 'mlp',
    towns: [
      t('Kottappadi', '676505', 11.051, 76.071),
      t('Manjeri', '676121', 11.12, 76.12),
      t('Perinthalmanna', '679322', 10.976, 76.225),
      t('Tirur', '676101', 10.914, 75.922),
      t('Kottakkal', '676503', 11.0, 75.996),
      t('Nilambur', '679329', 11.277, 76.225),
      t('Ponnani', '679577', 10.767, 75.925),
      t('Valanchery', '676552', 10.893, 76.07),
      t('Tirurangadi', '676306', 11.041, 75.923),
      t('Kondotty', '673638', 11.147, 75.96),
    ],
  },
  {
    name: 'Kozhikode',
    citySlug: 'kozhikode',
    key: 'kkd',
    towns: [
      t('Arayidathupalam', '673004', 11.2588, 75.7804),
      t('Vadakara', '673101', 11.608, 75.591),
      t('Koyilandy', '673305', 11.438, 75.697),
      t('Ramanattukara', '673633', 11.18, 75.864),
      t('Feroke', '673631', 11.181, 75.838),
      t('Thamarassery', '673573', 11.417, 75.942),
      t('Mukkam', '673602', 11.322, 75.994),
      t('Perambra', '673525', 11.563, 75.761),
      t('Kunnamangalam', '673571', 11.304, 75.878),
      t('Balussery', '673612', 11.447, 75.83),
    ],
  },
  {
    name: 'Wayanad',
    citySlug: 'wayanad',
    key: 'wyd',
    towns: [
      t('Kalpetta', '673121', 11.608, 76.083),
      t('Sulthan Bathery', '673592', 11.665, 76.258),
      t('Mananthavady', '670645', 11.801, 76.005),
      t('Meenangadi', '673591', 11.66, 76.17),
      t('Pulpally', '673579', 11.79, 76.162),
      t('Vythiri', '673576', 11.552, 76.04),
      t('Meppadi', '673577', 11.556, 76.135),
      t('Panamaram', '670721', 11.74, 76.073),
      t('Ambalavayal', '673593', 11.618, 76.212),
      t('Padinjarathara', '673575', 11.68, 75.97),
    ],
  },
  {
    name: 'Kannur',
    citySlug: 'kannur',
    key: 'knr',
    towns: [
      t('Thavakkara', '670001', 11.8745, 75.3704),
      t('Thalassery', '670101', 11.748, 75.492),
      t('Payyanur', '670307', 12.1, 75.202),
      t('Taliparamba', '670141', 12.038, 75.36),
      t('Iritty', '670703', 11.98, 75.67),
      t('Mattannur', '670702', 11.93, 75.57),
      t('Koothuparamba', '670643', 11.831, 75.565),
      t('Panoor', '670692', 11.76, 75.574),
      t('Sreekandapuram', '670631', 12.042, 75.505),
      t('Peravoor', '670673', 11.9, 75.74),
    ],
  },
  {
    name: 'Kasaragod',
    citySlug: 'kasaragod',
    key: 'ksd',
    towns: [
      t('Kasaragod Town', '671121', 12.4996, 74.9869),
      t('Kanhangad', '671315', 12.313, 75.091),
      t('Nileshwaram', '671314', 12.256, 75.136),
      t('Uppala', '671322', 12.678, 74.9),
      t('Manjeshwaram', '671323', 12.718, 74.885),
      t('Cheruvathur', '671313', 12.217, 75.16),
      t('Trikaripur', '671310', 12.14, 75.183),
      t('Bekal', '671318', 12.391, 75.033),
      t('Kumbla', '671321', 12.598, 74.948),
      t('Vellarikundu', '671533', 12.37, 75.329),
    ],
  },
];

/** Free Unsplash photos (file, Unsplash photo id, alt text), cropped to 1200x800 WebP. */
export const STOCK_PHOTOS: [file: string, unsplashId: string, alt: string][] = [
  ['stock-01.webp', 'photo-1763429338698-439aa108e7fb', 'Event hall with tables set for a banquet'],
  ['stock-02.webp', 'photo-1666617710768-425d2d9088f8', 'Large hall with tables set for a wedding'],
  ['stock-03.webp', 'photo-1768508951405-10e83c4a2872', 'Event space set with round dining tables'],
  ['stock-04.webp', 'photo-1712314947761-a8d718bd8c32', 'Banquet hall with chandeliers and tables'],
  [
    'stock-05.webp',
    'photo-1783314867628-220ab03cac99',
    'Ballroom with many tables set for a formal event',
  ],
  [
    'stock-06.webp',
    'photo-1677129663241-5be1f17fe6fe',
    'Banquet room with white tables and chairs',
  ],
  ['stock-07.webp', 'photo-1768851142332-75f3d1b47452', 'Banquet hall with round tables'],
  [
    'stock-08.webp',
    'photo-1759477274116-e3cb02d2b9d8',
    'Empty banquet hall with red chairs and round tables',
  ],
  [
    'stock-09.webp',
    'photo-1698934641149-93431f3bd4f7',
    'Banquet hall with tables, chairs and chandeliers',
  ],
  [
    'stock-10.webp',
    'photo-1675247488725-22d1b78e75db',
    'Dining hall with chandeliers and set tables',
  ],
  [
    'stock-11.webp',
    'photo-1761110787206-2cc164e4913c',
    'Dining hall with round tables and chandeliers',
  ],
  [
    'stock-12.webp',
    'photo-1780593116478-c46838f86523',
    'Ballroom with chandeliers and white tables',
  ],
  ['stock-13.webp', 'photo-1714004941173-0054629146c2', 'Hall filled with tables in white drapes'],
  ['stock-14.webp', 'photo-1632316962873-47ee3d309f02', 'Table set up for a wedding reception'],
  ['stock-15.webp', 'photo-1601482441062-b9f13131f33a', 'Hall with red and green chairs'],
  [
    'stock-16.webp',
    'photo-1769812343590-485512e27838',
    'Event tables with white flowers and chairs',
  ],
  ['stock-17.webp', 'photo-1779308936221-89739e035a53', 'Reception hall with a floral archway'],
  [
    'stock-18.webp',
    'photo-1762765685319-fdaf8d22085d',
    'Grand hall with long tables set for a banquet',
  ],
  [
    'stock-19.webp',
    'photo-1791791759125-921a90203790',
    'Banquet hall with rows of chairs and chandeliers',
  ],
  ['stock-20.webp', 'photo-1773407377203-faf8b19a2142', 'Banquet hall with long tables'],
  ['stock-21.webp', 'photo-1775918427144-51f0bf53f8c4', 'Banquet hall set up for an event'],
  ['stock-22.webp', 'photo-1768851244529-39180171a168', 'Event space with decorated high tables'],
  [
    'stock-23.webp',
    'photo-1763553113332-800519753e40',
    'Reception tables with floral centrepieces',
  ],
  [
    'stock-24.webp',
    'photo-1780337092331-6580fd9ccb47',
    'Dining room with floral table decorations',
  ],
  [
    'stock-25.webp',
    'photo-1745573673583-a51f665ae48e',
    'Wedding stage decorated with flowers and drapery',
  ],
  [
    'stock-26.webp',
    'photo-1762709118823-7fe9c9afa8ff',
    'Decorated wedding stage with sofas and flowers',
  ],
  ['stock-27.webp', 'photo-1745573674206-1d4805fcc427', 'Decorated stage for a wedding'],
  ['stock-28.webp', 'photo-1608713709464-04cfb951c93f', 'Red and white stage with a red curtain'],
  [
    'stock-29.webp',
    'photo-1745573673043-43a4f3b91466',
    'Venue decorated with flowers for an event',
  ],
  [
    'stock-30.webp',
    'photo-1772127822552-ce9ef537bdcf',
    'Decorated wedding arch with a floral aisle',
  ],
  ['stock-31.webp', 'photo-1708606811579-23b18fc48007', 'Decorated stage with a chandelier'],
  [
    'stock-32.webp',
    'photo-1773745060497-4cc1df774c72',
    'Wedding venue with chandeliers and flowers',
  ],
  [
    'stock-33.webp',
    'photo-1744891470493-44321ef136a2',
    'Outdoor event space with colourful canopies',
  ],
  ['stock-34.webp', 'photo-1744891471118-f74c0453cd21', 'Brightly decorated event entrance'],
  ['stock-35.webp', 'photo-1589463349208-95817c91f971', 'Yellow and red hanging decorations'],
  ['stock-36.webp', 'photo-1632012773667-b68d7bd59cc4', 'Auditorium with rows of red seats'],
  ['stock-37.webp', 'photo-1519452575417-564c1401ecc0', 'Auditorium seating facing the stage'],
  [
    'stock-38.webp',
    'photo-1738225734899-30852be7e396',
    'Ceremony aisle with green carpet and white flowers',
  ],
  [
    'stock-39.webp',
    'photo-1670529776180-60e4132ab90c',
    'Floral archway over a path with gold chairs',
  ],
];

// ---------- Deterministic generation ----------

/** mulberry32: a small seeded PRNG, so every run produces the same venues. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const NAME_STEMS = [
  'Sree Lakshmi',
  'Kailas',
  'Thejus',
  'Ganga',
  'Sree Bhadra',
  'Rajadhani',
  'Pearl',
  'Crystal',
  'Silver Oak',
  'Green Valley',
  'Royal Palm',
  'Coconut Grove',
  'Lotus',
  'Mayura',
  'Swarna',
  'Chandrika',
  'Navaratna',
  'Harmony',
  'Kalyani',
  'Bhavana',
  'Sreeragam',
  'Kairali',
  'Nila',
  'Sahya',
  'Thulasi',
  'Mangalya',
  'Shalini',
  'Haritha',
  'Ponnonam',
  'Vrindavan',
  'Sangamam',
  'Pournami',
  'Saffron',
  'Ivory',
  'Golden Leaf',
  'Sree Durga',
  'Anugraha',
  'Sopanam',
  'Kalpaka',
  'Malhar',
];

const VENUE_TYPES = [
  'Auditorium',
  'Convention Centre',
  'Kalyana Mandapam',
  'Function Hall',
  'Community Hall',
  'Event Centre',
  'Marriage Hall',
  'Banquet Hall',
  'Convention Hall',
  'Party Hall',
];

const ROADS = [
  'Temple Road',
  'Main Road',
  'Bypass Road',
  'Station Road',
  'Market Road',
  'Church Road',
  'School Junction',
  'Bus Stand Road',
  'Hospital Road',
  'NH Bypass',
];

const OWNER_NAMES = [
  ['Suresh Nair', 'Nair Event Spaces'],
  ['Deepa Pillai', 'Pillai Halls'],
  ['Joseph Varghese', 'Varghese Convention Services'],
  ['Fathima Rahman', 'Rahman Event Venues'],
  ['Rajeev Kurup', 'Kurup Auditoriums'],
  ['Anitha Menon', 'Menon Function Halls'],
  ['Thomas Mathew', 'Mathew Event Group'],
  ['Shameer Ali', 'Ali Convention Centres'],
  ['Gopika Warrier', 'Warrier Venues'],
  ['Biju Kurian', 'Kurian Event Halls'],
  ['Lekha Namboothiri', 'Namboothiri Mandapams'],
  ['Nizar Ahmed', 'Ahmed Banquets'],
  ['Prakash Panicker', 'Panicker Event Spaces'],
  ['Reshma Thampi', 'Thampi Convention Halls'],
] as const;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** list[i], failing loudly instead of yielding undefined if the data and indexes drift. */
function at<T>(list: readonly T[], i: number): T {
  const item = list[i];
  if (item === undefined) throw new Error(`no item at index ${i}`);
  return item;
}

/** One owner per district, on the reserved .test domain. */
export const KERALA_TEST_OWNERS: SampleOwner[] = KERALA_DISTRICTS.map((d, i) => ({
  email: `owner.${d.key}@example.test`,
  fullName: at(OWNER_NAMES, i)[0],
  phone: `+9198000010${String(i + 1).padStart(2, '0')}`,
  businessName: at(OWNER_NAMES, i)[1],
}));

function buildVenue(district: District, town: Town, index: number, ownerEmail: string) {
  const r = rng(index * 7919 + 17);
  const pick = <T>(list: readonly T[]) => at(list, Math.floor(r() * list.length));
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);

  const stem = at(NAME_STEMS, (index * 11 + 3) % NAME_STEMS.length);
  const type = at(VENUE_TYPES, (index * 7 + Math.floor(index / 10)) % VENUE_TYPES.length);
  const name = `${stem} ${type}`;

  const mainSeats = roundTo(between(300, 2000), 50);
  const mainAc = r() < 0.65;
  const perSeat = between(35, 110) * (mainAc ? 1.25 : 1);
  const priced = (seats: number, rate: number): SampleHall['baseRupees'] => {
    const morning = roundTo(seats * rate, 1000);
    return {
      MORNING: morning,
      EVENING: roundTo(morning * 0.85, 1000),
      FULL_DAY: roundTo(morning * 1.5, 1000),
    };
  };
  const halls: SampleHall[] = [
    {
      name: mainSeats >= 1000 ? 'Main Hall' : 'Hall',
      seatingCapacity: mainSeats,
      diningCapacity: roundTo(mainSeats * between(0.4, 0.7), 50),
      isAc: mainAc,
      baseRupees: priced(mainSeats, perSeat),
      weekendUpliftPercent: roundTo(between(10, 20), 5),
      muhurthamUpliftPercent: roundTo(between(20, 40), 5),
    },
  ];
  if (mainSeats >= 700 && r() < 0.45) {
    const miniSeats = roundTo(between(150, 400), 50);
    halls.push({
      name: 'Mini Hall',
      seatingCapacity: miniSeats,
      diningCapacity: roundTo(miniSeats * 0.6, 10),
      isAc: true,
      baseRupees: priced(miniSeats, perSeat * 1.1),
      weekendUpliftPercent: 10,
      muhurthamUpliftPercent: 25,
    });
  }

  const guestRooms = r() < 0.4 ? Math.floor(between(2, 12)) : 0;
  const hasGenerator = r() < 0.8;
  const parkingCars = roundTo(mainSeats / between(6, 12), 5);
  const amenities = [
    'stage',
    'car_parking',
    'sound_system',
    'dining_hall',
    ...(halls.some((h) => h.isAc) ? ['air_conditioning'] : []),
    ...(hasGenerator ? ['power_backup'] : []),
    ...(guestRooms > 0 ? ['guest_rooms'] : []),
    ...(r() < 0.6 ? ['bridal_room'] : []),
    ...(r() < 0.5 ? ['groom_room'] : []),
    ...(r() < 0.5 ? ['kitchen'] : []),
    ...(r() < 0.4 ? ['cctv'] : []),
    ...(r() < 0.3 ? ['lift'] : []),
    ...(r() < 0.35 ? ['wheelchair_access'] : []),
    ...(r() < 0.25 ? ['projector'] : []),
    ...(r() < 0.3 ? ['wifi'] : []),
  ];

  const features = [
    halls.length > 1 ? 'a separate mini hall' : null,
    mainAc ? 'a fully air-conditioned main hall' : 'a large, airy main hall',
    guestRooms > 0 ? `${guestRooms} rooms for guests` : null,
    `parking for about ${parkingCars} cars`,
  ].filter(Boolean);

  const venue: SampleAuditorium = {
    ownerEmail,
    citySlug: district.citySlug,
    name,
    slug: slugify(`${name} ${town.locality} ${district.key}`),
    description:
      `${name} is ${/^[AEIOU]/.test(type) ? 'an' : 'a'} ${type.toLowerCase()} in ` +
      `${town.locality}, ${district.name} district, ` +
      `seating up to ${mainSeats} guests, with ${features.join(', ')}. ` +
      'Test listing: this venue is invented for trying out MandapamBook and is not a real business.',
    addressLine: `${Math.floor(between(1, 400))}/${Math.floor(between(1, 30))}, ${pick(ROADS)}`,
    locality: town.locality,
    pincode: town.pincode,
    // Within about 1 km of the town centre, so venues in one town don't share a pin.
    latitude: Number((town.latitude + between(-0.008, 0.008)).toFixed(5)),
    longitude: Number((town.longitude + between(-0.008, 0.008)).toFixed(5)),
    cateringPolicy: pick(['OUTSIDE_ALLOWED', 'OUTSIDE_ALLOWED', 'IN_HOUSE_ONLY', 'NO_CATERING']),
    decorationPolicy: pick(['OUTSIDE_ALLOWED', 'OUTSIDE_ALLOWED', 'IN_HOUSE_ONLY']),
    parkingCars,
    parkingTwoWheelers: roundTo(parkingCars * between(1.5, 3), 10),
    guestRooms,
    hasGenerator,
    advancePercent: pick([20, 25, 25, 30, 50]),
    instantBook: r() < 0.7,
    amenities,
    halls,
    addons: [
      ...(guestRooms > 0
        ? [
            {
              code: 'guest_room',
              name: 'Guest room (per night)',
              unit: 'PER_ROOM' as const,
              rupees: roundTo(between(1500, 4000), 100),
              maxQuantity: guestRooms,
            },
          ]
        : []),
      ...(hasGenerator
        ? [
            {
              code: 'generator',
              name: 'Generator backup',
              unit: 'PER_EVENT' as const,
              rupees: roundTo(between(5000, 12000), 500),
              maxQuantity: 1,
            },
          ]
        : []),
      {
        code: 'decoration_premium',
        name: 'Stage decoration (premium)',
        unit: 'PER_EVENT',
        rupees: roundTo(between(15000, 60000), 1000),
        maxQuantity: 1,
      },
      ...(r() < 0.5
        ? [
            {
              code: 'chenda_melam',
              name: 'Chenda melam',
              unit: 'PER_EVENT' as const,
              rupees: roundTo(between(8000, 20000), 500),
              maxQuantity: 1,
            },
          ]
        : []),
    ],
    cancellationTiers:
      r() < 0.7
        ? [
            { minDaysBefore: 60, refundPercent: 90 },
            { minDaysBefore: 30, refundPercent: 50 },
            { minDaysBefore: 7, refundPercent: 25 },
            { minDaysBefore: 0, refundPercent: 0 },
          ]
        : [
            { minDaysBefore: 90, refundPercent: 75 },
            { minDaysBefore: 30, refundPercent: 25 },
            { minDaysBefore: 0, refundPercent: 0 },
          ],
  };
  return venue;
}

/** 140 venues: 10 per district, in the order of KERALA_DISTRICTS. */
export const KERALA_TEST_AUDITORIUMS: SampleAuditorium[] = KERALA_DISTRICTS.flatMap((d, di) =>
  d.towns.map((town, ti) => buildVenue(d, town, di * 10 + ti, at(KERALA_TEST_OWNERS, di).email)),
);

/** Two different stock photos per venue, spread so neighbours rarely share one. */
export function stockPhotosFor(index: number): [string, string][] {
  const n = STOCK_PHOTOS.length;
  const a = (index * 7) % n;
  const b = (a + 13 + (index % 11)) % n;
  return [a, b].map((i) => [at(STOCK_PHOTOS, i)[0], at(STOCK_PHOTOS, i)[2]]);
}
