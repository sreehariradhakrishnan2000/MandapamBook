/**
 * Fictional sample venues for development and demos. Never loaded in production.
 * All names, people and addresses are invented; emails use the reserved .test TLD.
 */
import type { CancellationTier } from '../schema/venues.js';

type Slot = 'MORNING' | 'EVENING' | 'FULL_DAY';

export interface SampleOwner {
  email: string;
  fullName: string;
  phone: string;
  businessName: string;
}

export interface SampleHall {
  name: string;
  seatingCapacity: number;
  diningCapacity: number;
  isAc: boolean;
  /** Defaults to the hall's own AC when not given. */
  diningIsAc?: boolean;
  /** Base price per slot in rupees (converted to paise when seeding). */
  baseRupees: Record<Slot, number>;
  /** Extra percentage on weekends and muhurtham days. */
  weekendUpliftPercent: number;
  muhurthamUpliftPercent: number;
}

export interface SampleAuditorium {
  ownerEmail: string;
  citySlug: string;
  name: string;
  slug: string;
  description: string;
  addressLine: string;
  locality: string;
  pincode: string;
  latitude: number;
  longitude: number;
  cateringPolicy: 'IN_HOUSE_ONLY' | 'OUTSIDE_ALLOWED' | 'NO_CATERING';
  decorationPolicy: 'IN_HOUSE_ONLY' | 'OUTSIDE_ALLOWED' | 'NOT_ALLOWED';
  parkingCars: number;
  parkingTwoWheelers: number;
  guestRooms: number;
  hasGenerator: boolean;
  sadyaPrepArea?: boolean;
  cookingEquipment?: boolean;
  advancePercent: number;
  instantBook: boolean;
  amenities: string[];
  halls: SampleHall[];
  addons: {
    code: string;
    name: string;
    unit: 'PER_EVENT' | 'PER_ROOM' | 'PER_HOUR';
    rupees: number;
    maxQuantity: number;
  }[];
  cancellationTiers: CancellationTier[];
}

export const SAMPLE_OWNERS: SampleOwner[] = [
  {
    email: 'owner.kerala@example.test',
    fullName: 'Anil Menon',
    phone: '+919800000001',
    businessName: 'Menon Event Spaces',
  },
  {
    email: 'owner.tamilnadu@example.test',
    fullName: 'Lakshmi Sundaram',
    phone: '+919800000002',
    businessName: 'Sundaram Mahal Group',
  },
  {
    email: 'owner.karnataka@example.test',
    fullName: 'Ravi Hegde',
    phone: '+919800000003',
    businessName: 'Hegde Convention Services',
  },
];

const STANDARD_TIERS: CancellationTier[] = [
  { minDaysBefore: 60, refundPercent: 90 },
  { minDaysBefore: 30, refundPercent: 50 },
  { minDaysBefore: 7, refundPercent: 25 },
  { minDaysBefore: 0, refundPercent: 0 },
];

const STRICT_TIERS: CancellationTier[] = [
  { minDaysBefore: 90, refundPercent: 75 },
  { minDaysBefore: 30, refundPercent: 25 },
  { minDaysBefore: 0, refundPercent: 0 },
];

export const SAMPLE_AUDITORIUMS: SampleAuditorium[] = [
  {
    ownerEmail: 'owner.kerala@example.test',
    citySlug: 'kochi',
    name: 'Sree Padmanabha Kalyana Mandapam',
    slug: 'sree-padmanabha-kalyana-mandapam-kochi',
    description:
      'A traditional mandapam with a carved wooden stage, close to the Edappally junction. Separate dining hall for 600.',
    addressLine: '14/220 Temple Road, Edappally',
    locality: 'Edappally',
    pincode: '682024',
    latitude: 10.0261,
    longitude: 76.3084,
    cateringPolicy: 'OUTSIDE_ALLOWED',
    decorationPolicy: 'OUTSIDE_ALLOWED',
    parkingCars: 120,
    parkingTwoWheelers: 200,
    guestRooms: 8,
    hasGenerator: true,
    advancePercent: 25,
    instantBook: true,
    amenities: [
      'air_conditioning',
      'dining_hall',
      'stage',
      'bridal_room',
      'groom_room',
      'car_parking',
      'power_backup',
      'guest_rooms',
      'kitchen',
    ],
    halls: [
      {
        name: 'Main Hall',
        seatingCapacity: 1000,
        diningCapacity: 600,
        isAc: true,
        baseRupees: { MORNING: 85000, EVENING: 75000, FULL_DAY: 140000 },
        weekendUpliftPercent: 10,
        muhurthamUpliftPercent: 25,
      },
      {
        name: 'Mini Hall',
        seatingCapacity: 250,
        diningCapacity: 150,
        isAc: true,
        baseRupees: { MORNING: 30000, EVENING: 28000, FULL_DAY: 50000 },
        weekendUpliftPercent: 10,
        muhurthamUpliftPercent: 20,
      },
    ],
    addons: [
      {
        code: 'guest_room',
        name: 'Guest room (per night)',
        unit: 'PER_ROOM',
        rupees: 2500,
        maxQuantity: 8,
      },
      {
        code: 'generator',
        name: 'Generator backup',
        unit: 'PER_EVENT',
        rupees: 8000,
        maxQuantity: 1,
      },
      { code: 'sound', name: 'Sound and lights', unit: 'PER_EVENT', rupees: 12000, maxQuantity: 1 },
    ],
    cancellationTiers: STANDARD_TIERS,
  },
  {
    ownerEmail: 'owner.kerala@example.test',
    citySlug: 'thrissur',
    name: 'Vadakkunnathan Convention Centre',
    slug: 'vadakkunnathan-convention-centre-thrissur',
    description:
      'Large convention centre near the Swaraj Round, popular for Guruvayur wedding receptions. In-house sadya catering.',
    addressLine: 'Round North, near Swaraj Round',
    locality: 'Round North',
    pincode: '680001',
    latitude: 10.5276,
    longitude: 76.2144,
    cateringPolicy: 'IN_HOUSE_ONLY',
    decorationPolicy: 'IN_HOUSE_ONLY',
    parkingCars: 250,
    parkingTwoWheelers: 400,
    guestRooms: 20,
    hasGenerator: true,
    advancePercent: 30,
    instantBook: false,
    amenities: [
      'air_conditioning',
      'dining_hall',
      'stage',
      'bridal_room',
      'groom_room',
      'car_parking',
      'power_backup',
      'lift',
      'wheelchair_access',
      'sound_system',
      'guest_rooms',
      'cctv',
    ],
    halls: [
      {
        name: 'Grand Hall',
        seatingCapacity: 2000,
        diningCapacity: 1200,
        isAc: true,
        baseRupees: { MORNING: 175000, EVENING: 150000, FULL_DAY: 290000 },
        weekendUpliftPercent: 15,
        muhurthamUpliftPercent: 30,
      },
    ],
    addons: [
      {
        code: 'guest_room',
        name: 'Guest room (per night)',
        unit: 'PER_ROOM',
        rupees: 3200,
        maxQuantity: 20,
      },
      {
        code: 'decoration_premium',
        name: 'Premium floral decoration',
        unit: 'PER_EVENT',
        rupees: 45000,
        maxQuantity: 1,
      },
    ],
    cancellationTiers: STRICT_TIERS,
  },
  {
    ownerEmail: 'owner.kerala@example.test',
    citySlug: 'thiruvananthapuram',
    name: 'Kovalam Road Auditorium',
    slug: 'kovalam-road-auditorium-thiruvananthapuram',
    description: 'Budget-friendly non-AC auditorium with ample parking. Outside caterers welcome.',
    addressLine: 'TC 42/1100, Kovalam Road, Thiruvallam',
    locality: 'Thiruvallam',
    pincode: '695027',
    latitude: 8.4366,
    longitude: 76.9637,
    cateringPolicy: 'OUTSIDE_ALLOWED',
    decorationPolicy: 'OUTSIDE_ALLOWED',
    parkingCars: 80,
    parkingTwoWheelers: 150,
    guestRooms: 0,
    hasGenerator: false,
    advancePercent: 20,
    instantBook: true,
    amenities: ['dining_hall', 'stage', 'car_parking', 'kitchen'],
    halls: [
      {
        name: 'Auditorium',
        seatingCapacity: 700,
        diningCapacity: 350,
        isAc: false,
        baseRupees: { MORNING: 35000, EVENING: 30000, FULL_DAY: 55000 },
        weekendUpliftPercent: 5,
        muhurthamUpliftPercent: 15,
      },
    ],
    addons: [
      {
        code: 'generator',
        name: 'Generator (rented)',
        unit: 'PER_EVENT',
        rupees: 6500,
        maxQuantity: 1,
      },
    ],
    cancellationTiers: STANDARD_TIERS,
  },
  {
    ownerEmail: 'owner.tamilnadu@example.test',
    citySlug: 'chennai',
    name: 'Sundaram Thirumana Mahal',
    slug: 'sundaram-thirumana-mahal-chennai',
    description:
      'AC kalyana mandapam in Mylapore with a vegetarian in-house kitchen and rooms for both families.',
    addressLine: '22 Kutchery Road, Mylapore',
    locality: 'Mylapore',
    pincode: '600004',
    latitude: 13.0339,
    longitude: 80.2695,
    cateringPolicy: 'IN_HOUSE_ONLY',
    decorationPolicy: 'OUTSIDE_ALLOWED',
    parkingCars: 60,
    parkingTwoWheelers: 120,
    guestRooms: 12,
    hasGenerator: true,
    advancePercent: 25,
    instantBook: true,
    amenities: [
      'air_conditioning',
      'dining_hall',
      'stage',
      'bridal_room',
      'groom_room',
      'car_parking',
      'power_backup',
      'lift',
      'guest_rooms',
    ],
    halls: [
      {
        name: 'Mahal',
        seatingCapacity: 800,
        diningCapacity: 400,
        isAc: true,
        baseRupees: { MORNING: 120000, EVENING: 95000, FULL_DAY: 200000 },
        weekendUpliftPercent: 10,
        muhurthamUpliftPercent: 35,
      },
    ],
    addons: [
      {
        code: 'guest_room',
        name: 'Guest room (per night)',
        unit: 'PER_ROOM',
        rupees: 2800,
        maxQuantity: 12,
      },
      {
        code: 'nadaswaram',
        name: 'Nadaswaram ensemble',
        unit: 'PER_EVENT',
        rupees: 18000,
        maxQuantity: 1,
      },
    ],
    cancellationTiers: STANDARD_TIERS,
  },
  {
    ownerEmail: 'owner.tamilnadu@example.test',
    citySlug: 'coimbatore',
    name: 'Kovai Grand Convention Hall',
    slug: 'kovai-grand-convention-hall-coimbatore',
    description:
      'Convention hall on Avinashi Road with two halls that can host a wedding and reception on the same day.',
    addressLine: '1450 Avinashi Road, Peelamedu',
    locality: 'Peelamedu',
    pincode: '641004',
    latitude: 11.0247,
    longitude: 77.0028,
    cateringPolicy: 'OUTSIDE_ALLOWED',
    decorationPolicy: 'OUTSIDE_ALLOWED',
    parkingCars: 300,
    parkingTwoWheelers: 500,
    guestRooms: 6,
    hasGenerator: true,
    advancePercent: 20,
    instantBook: true,
    amenities: [
      'air_conditioning',
      'dining_hall',
      'stage',
      'bridal_room',
      'car_parking',
      'power_backup',
      'projector',
      'sound_system',
      'wifi',
      'cctv',
    ],
    halls: [
      {
        name: 'Hall A',
        seatingCapacity: 1500,
        diningCapacity: 800,
        isAc: true,
        baseRupees: { MORNING: 110000, EVENING: 100000, FULL_DAY: 185000 },
        weekendUpliftPercent: 10,
        muhurthamUpliftPercent: 25,
      },
      {
        name: 'Hall B',
        seatingCapacity: 500,
        diningCapacity: 300,
        isAc: true,
        baseRupees: { MORNING: 45000, EVENING: 42000, FULL_DAY: 75000 },
        weekendUpliftPercent: 10,
        muhurthamUpliftPercent: 20,
      },
    ],
    addons: [
      {
        code: 'sound',
        name: 'Sound, lights and LED wall',
        unit: 'PER_EVENT',
        rupees: 25000,
        maxQuantity: 1,
      },
    ],
    cancellationTiers: STANDARD_TIERS,
  },
  {
    ownerEmail: 'owner.karnataka@example.test',
    citySlug: 'bengaluru',
    name: 'Basavanagudi Kalyana Mantapa',
    slug: 'basavanagudi-kalyana-mantapa-bengaluru',
    description:
      'Heritage-style kalyana mantapa near Bull Temple Road with a lawn for evening receptions.',
    addressLine: '7 Bull Temple Road, Basavanagudi',
    locality: 'Basavanagudi',
    pincode: '560004',
    latitude: 12.9428,
    longitude: 77.5683,
    cateringPolicy: 'OUTSIDE_ALLOWED',
    decorationPolicy: 'IN_HOUSE_ONLY',
    parkingCars: 90,
    parkingTwoWheelers: 160,
    guestRooms: 10,
    hasGenerator: true,
    advancePercent: 30,
    instantBook: false,
    amenities: [
      'dining_hall',
      'stage',
      'bridal_room',
      'groom_room',
      'car_parking',
      'power_backup',
      'guest_rooms',
      'kitchen',
      'wheelchair_access',
    ],
    halls: [
      {
        name: 'Mantapa',
        seatingCapacity: 900,
        diningCapacity: 450,
        isAc: false,
        baseRupees: { MORNING: 95000, EVENING: 85000, FULL_DAY: 160000 },
        weekendUpliftPercent: 12,
        muhurthamUpliftPercent: 30,
      },
    ],
    addons: [
      {
        code: 'guest_room',
        name: 'Guest room (per night)',
        unit: 'PER_ROOM',
        rupees: 3000,
        maxQuantity: 10,
      },
      {
        code: 'generator',
        name: 'Generator backup',
        unit: 'PER_EVENT',
        rupees: 9000,
        maxQuantity: 1,
      },
    ],
    cancellationTiers: STRICT_TIERS,
  },
];
