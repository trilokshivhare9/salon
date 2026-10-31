export interface QueueItemService {
  id: string;
  serviceId: string | null;
  name: string;
  durationMinutes: number;
  price: number;
  orderIndex: number;
}

export interface QueueItemCustomer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

export interface QueueItemStylist {
  id: string;
  name: string;
  avatarUrl: string | null;
  colorCode: string;
}

export interface QueueItem {
  id: string;
  appointmentNumber: string;
  status: string;
  source: string;
  bookingType: string;
  startAt: string | Date;
  endAt: string | Date;
  proposedStartAt?: string | Date | null;
  proposedEndAt?: string | Date | null;
  proposedStylistId?: string | null;
  expiresAt?: string | Date | null;
  customer: QueueItemCustomer;
  stylist: QueueItemStylist;
  services: QueueItemService[];
  totalDurationMinutes: number;
  totalPrice: number;
  nextActionType: string | null;
  nextActionAt: string | Date | null;
  cancellationReason: string | null;
  cancelledAt: string | Date | null;
  notes: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface QueueSummary {
  inChair: number;
  checkedIn: number;
  upcoming: number;
  completed: number;
  cancelled: number;
}

export interface QueuePagination {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface QueueResponse {
  success: boolean;
  data: {
    items: QueueItem[];
    pagination: QueuePagination;
    queueSummary: QueueSummary;
  };
}
