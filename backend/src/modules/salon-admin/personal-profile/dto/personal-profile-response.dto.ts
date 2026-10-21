export interface OwnerProfileInfo {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  createdAt: Date;
}

export interface SalonProfileInfo {
  id: string;
  name: string;
  slug: string;
  phone: string;
  email: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  locationType: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonalProfileResponse {
  owner: OwnerProfileInfo;
  salon: SalonProfileInfo;
}
