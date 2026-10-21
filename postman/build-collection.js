const fs = require('fs');
const path = require('path');

const collection = {
  info: {
    _postman_id: 'styleslot-saas-platform-v2',
    name: 'StyleSlot — Salon SaaS & Multi-Tenant Platform API',
    description: 'Complete Postman API Collection for StyleSlot Salon Management System. Includes authentication, super-admin platform administration, salon owner operations, staff & shift scheduling, dynamic calendar & closures, breaks, appointments & queue management, client WhatsApp channels, and public booking engine.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  auth: {
    type: 'bearer',
    bearer: [
      {
        key: 'token',
        value: '{{token}}',
        type: 'string'
      }
    ]
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000/api/v1', type: 'string' },
    { key: 'token', value: '', type: 'string' },
    { key: 'refreshToken', value: '', type: 'string' },
    { key: 'salonId', value: 'c9053910-1847-49f3-8f0d-58744b6e5e8e', type: 'string' },
    { key: 'salonSlug', value: 'glamour-studio', type: 'string' },
    { key: 'staffId', value: '', type: 'string' },
    { key: 'serviceId', value: '', type: 'string' },
    { key: 'categoryId', value: '', type: 'string' },
    { key: 'appointmentId', value: '', type: 'string' },
    { key: 'closureId', value: '', type: 'string' },
    { key: 'breakId', value: '', type: 'string' },
    { key: 'routineBreakId', value: '', type: 'string' },
    { key: 'customerId', value: '', type: 'string' },
    { key: 'errorLogId', value: '', type: 'string' },
    { key: 'masterCategoryId', value: '', type: 'string' }
  ],
  item: [
    // -------------------------------------------------------------------------
    // FOLDER 1: Core & Health
    // -------------------------------------------------------------------------
    {
      name: '1. Core & Health',
      description: 'System health checks, keep-alive endpoints, and uptime probes.',
      item: [
        {
          name: 'Keep-Alive Ping (Ultra-Lightweight)',
          request: {
            auth: { type: 'noauth' },
            method: 'GET',
            header: [],
            url: {
              raw: '{{baseUrl}}/health/ping',
              host: ['{{baseUrl}}'],
              path: ['health', 'ping']
            },
            description: 'Responds in <1ms without hitting database. Ideal for UptimeRobot, load balancers, or Kubernetes probes.'
          }
        },
        {
          name: 'System Health Check (DB Connectivity)',
          request: {
            auth: { type: 'noauth' },
            method: 'GET',
            header: [],
            url: {
              raw: '{{baseUrl}}/health',
              host: ['{{baseUrl}}'],
              path: ['health']
            },
            description: 'Queries PostgreSQL to confirm DB connection and returns uptime status.'
          }
        }
      ]
    },

    // -------------------------------------------------------------------------
    // FOLDER 2: Authentication & Profile
    // -------------------------------------------------------------------------
    {
      name: '2. Authentication & Admin Profile',
      description: 'Authentication, registration, JWT refresh, password reset, and admin profile updates.',
      item: [
        {
          name: 'Login (Salon Admin or Super Admin)',
          event: [
            {
              listen: 'test',
              script: {
                type: 'text/javascript',
                exec: [
                  'var jsonData = pm.response.json();',
                  'if (jsonData.accessToken || jsonData.token) {',
                  '  pm.collectionVariables.set("token", jsonData.accessToken || jsonData.token);',
                  '}',
                  'if (jsonData.refreshToken) {',
                  '  pm.collectionVariables.set("refreshToken", jsonData.refreshToken);',
                  '}',
                  'if (jsonData.admin && jsonData.admin.salonId) {',
                  '  pm.collectionVariables.set("salonId", jsonData.admin.salonId);',
                  '} else if (jsonData.salon && jsonData.salon.id) {',
                  '  pm.collectionVariables.set("salonId", jsonData.salon.id);',
                  '}',
                  'if (jsonData.salon && jsonData.salon.slug) {',
                  '  pm.collectionVariables.set("salonSlug", jsonData.salon.slug);',
                  '}'
                ]
              }
            }
          ],
          request: {
            auth: { type: 'noauth' },
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                email: 'glamour@example.com',
                password: 'Password@123'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/login',
              host: ['{{baseUrl}}'],
              path: ['auth', 'login']
            },
            description: 'Authenticate salon owner or super admin. Sets access token and tenant salon ID in collection variables.'
          }
        },
        {
          name: 'Register New Salon',
          event: [
            {
              listen: 'test',
              script: {
                type: 'text/javascript',
                exec: [
                  'var jsonData = pm.response.json();',
                  'if (jsonData.accessToken) pm.collectionVariables.set("token", jsonData.accessToken);',
                  'if (jsonData.refreshToken) pm.collectionVariables.set("refreshToken", jsonData.refreshToken);',
                  'if (jsonData.salon && jsonData.salon.id) pm.collectionVariables.set("salonId", jsonData.salon.id);'
                ]
              }
            }
          ],
          request: {
            auth: { type: 'noauth' },
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                salonName: 'Luxe Hair & Spa Studio',
                ownerName: 'Vikram Mehta',
                email: 'vikram@luxehair.com',
                mobile: '9876543210',
                password: 'Password@123',
                city: 'Mumbai',
                category: 'UNISEX_SALON'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/register',
              host: ['{{baseUrl}}'],
              path: ['auth', 'register']
            },
            description: 'Self-serve registration for new salon tenant.'
          }
        },
        {
          name: 'Refresh Access Token',
          event: [
            {
              listen: 'test',
              script: {
                type: 'text/javascript',
                exec: [
                  'var jsonData = pm.response.json();',
                  'if (jsonData.accessToken) pm.collectionVariables.set("token", jsonData.accessToken);',
                  'if (jsonData.refreshToken) pm.collectionVariables.set("refreshToken", jsonData.refreshToken);'
                ]
              }
            }
          ],
          request: {
            auth: { type: 'noauth' },
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                refreshToken: '{{refreshToken}}'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/refresh',
              host: ['{{baseUrl}}'],
              path: ['auth', 'refresh']
            },
            description: 'Obtain new short-lived access token using valid refresh token.'
          }
        },
        {
          name: 'Get Current Authenticated User (Me)',
          request: {
            method: 'GET',
            header: [],
            url: {
              raw: '{{baseUrl}}/auth/me',
              host: ['{{baseUrl}}'],
              path: ['auth', 'me']
            },
            description: 'Returns authenticated admin user profile, role, and associated salon information.'
          }
        },
        {
          name: 'Update Admin Profile',
          request: {
            method: 'PATCH',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                name: 'Vikram Mehta (Owner)',
                email: 'vikram.mehta@luxehair.com',
                phone: '9876543210'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/profile',
              host: ['{{baseUrl}}'],
              path: ['auth', 'profile']
            },
            description: 'Updates personal name, recovery email, or phone of logged in administrator.'
          }
        },
        {
          name: 'Change Password',
          request: {
            method: 'PATCH',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                currentPassword: 'Password@123',
                newPassword: 'NewSecurePassword@456'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/change-password',
              host: ['{{baseUrl}}'],
              path: ['auth', 'change-password']
            },
            description: 'Change current admin password while authenticated.'
          }
        },
        {
          name: 'Forgot Password - Step 1: Lookup by Mobile',
          request: {
            auth: { type: 'noauth' },
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                mobile: '9876543210'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/forgot-password-lookup',
              host: ['{{baseUrl}}'],
              path: ['auth', 'forgot-password-lookup']
            },
            description: 'Checks if mobile is registered with a salon.'
          }
        },
        {
          name: 'Forgot Password - Step 2: Request OTP',
          request: {
            auth: { type: 'noauth' },
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                identifier: '9876543210'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/forgot-password',
              host: ['{{baseUrl}}'],
              path: ['auth', 'forgot-password']
            },
            description: 'Sends 6-digit OTP code to registered mobile or email.'
          }
        },
        {
          name: 'Forgot Password - Step 3: Reset with OTP',
          request: {
            auth: { type: 'noauth' },
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                identifier: '9876543210',
                otp: '123456',
                newPassword: 'BrandNewPassword@789'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/reset-password-otp',
              host: ['{{baseUrl}}'],
              path: ['auth', 'reset-password-otp']
            },
            description: 'Validates 6-digit OTP and updates password.'
          }
        },
        {
          name: 'Logout Current Session',
          request: {
            auth: { type: 'noauth' },
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: JSON.stringify({
                refreshToken: '{{refreshToken}}'
              }, null, 2)
            },
            url: {
              raw: '{{baseUrl}}/auth/logout',
              host: ['{{baseUrl}}'],
              path: ['auth', 'logout']
            },
            description: 'Revokes the current refresh token.'
          }
        },
        {
          name: 'Logout All Devices',
          request: {
            method: 'POST',
            header: [],
            url: {
              raw: '{{baseUrl}}/auth/logout-all',
              host: ['{{baseUrl}}'],
              path: ['auth', 'logout-all']
            },
            description: 'Revokes all active sessions and refresh tokens for this admin.'
          }
        }
      ]
    },

    // -------------------------------------------------------------------------
    // FOLDER 3: Super Admin (Platform Owner)
    // -------------------------------------------------------------------------
    {
      name: '3. Super Admin (Platform Owner)',
      description: 'Platform tenant onboarding, multi-salon lifecycle, global error tracking, and master categories.',
      item: [
        // 3.1 Platform Salons
        {
          name: '3.1 Platform Salons Management',
          item: [
            {
              name: 'Get All Salons on Platform',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/platform/all',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'platform', 'all']
                },
                description: 'Lists all registered salons across the platform with owner details, active staff, and WhatsApp status (Super Admin only).'
              }
            },
            {
              name: 'Create Salon by Super Admin',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Crown Heritage Salon & Lounge',
                    slug: 'crown-heritage',
                    category: 'UNISEX_SALON',
                    currency: 'INR',
                    ownerName: 'Amit Verma',
                    email: 'amit@crownheritage.com',
                    password: 'SecurePassword@123',
                    phone: '9822334455',
                    address: 'Plot 45, Commercial Bay, Bandra West',
                    city: 'Mumbai',
                    state: 'Maharashtra',
                    country: 'India',
                    timezone: 'Asia/Kolkata'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/salons/platform/create',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'platform', 'create']
                },
                description: 'Direct onboarding of new salon tenant by Platform Super Admin.'
              }
            },
            {
              name: 'Get Deactivation Preview',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/platform/{{salonId}}/deactivation-preview',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'platform', '{{salonId}}', 'deactivation-preview']
                },
                description: 'Previews count of active appointments and affected customers before deactivating a salon.'
              }
            },
            {
              name: 'Toggle Salon Status (Activate / Deactivate)',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    forceCancelBookings: true
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/salons/platform/{{salonId}}/toggle-status',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'platform', '{{salonId}}', 'toggle-status']
                },
                description: 'Toggles salon between ACTIVE and DEACTIVATED. When forceCancelBookings=true, pending bookings are automatically cancelled with system notification.'
              }
            },
            {
              name: 'Verify Meta Phone Number',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    phone: '+919811122233',
                    usePlatformBot: true
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/salons/platform/verify-phone-number',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'platform', 'verify-phone-number']
                },
                description: 'Queries Meta Cloud API to check if a phone number is registered for WhatsApp Cloud API.'
              }
            },
            {
              name: 'Verify Meta Phone ID',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/platform/verify-meta-phone/109876543210987',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'platform', 'verify-meta-phone', '109876543210987']
                },
                description: 'Verifies phone ID ownership against Meta Graph API.'
              }
            },
            {
              name: 'Link WhatsApp Account to Salon',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    phoneNumberId: '109876543210987'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/salons/platform/{{salonId}}/link-whatsapp',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'platform', '{{salonId}}', 'link-whatsapp']
                },
                description: 'Attaches a verified Meta Phone Number ID to a tenant salon.'
              }
            },
            {
              name: 'Delete Salon (Permanently)',
              request: {
                method: 'DELETE',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/platform/{{salonId}}',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'platform', '{{salonId}}']
                },
                description: 'Hard deletes a salon tenant and cleans up related records (Super Admin only).'
              }
            }
          ]
        },

        // 3.2 Master Categories
        {
          name: '3.2 Master Categories',
          item: [
            {
              name: 'List Master Categories',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/super-admin/categories',
                  host: ['{{baseUrl}}'],
                  path: ['super-admin', 'categories']
                },
                description: 'Lists all global platform categories (e.g. Haircuts, Beard Grooming, Facials, Spa).'
              }
            },
            {
              name: 'Create Master Category',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (jsonData.id) pm.collectionVariables.set("masterCategoryId", jsonData.id);'
                    ]
                  }
                }
              ],
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Bridal & Grooming Packages',
                    icon: '👑',
                    sortOrder: 5
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/super-admin/categories',
                  host: ['{{baseUrl}}'],
                  path: ['super-admin', 'categories']
                },
                description: 'Creates a global service category template for all salons.'
              }
            },
            {
              name: 'Update Master Category',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Luxury Bridal & Grooming Packages',
                    icon: '💍',
                    sortOrder: 4
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/super-admin/categories/{{masterCategoryId}}',
                  host: ['{{baseUrl}}'],
                  path: ['super-admin', 'categories', '{{masterCategoryId}}']
                },
                description: 'Updates a master category.'
              }
            },
            {
              name: 'Delete Master Category',
              request: {
                method: 'DELETE',
                header: [],
                url: {
                  raw: '{{baseUrl}}/super-admin/categories/{{masterCategoryId}}',
                  host: ['{{baseUrl}}'],
                  path: ['super-admin', 'categories', '{{masterCategoryId}}']
                },
                description: 'Deletes a master category.'
              }
            }
          ]
        },

        // 3.3 System Error Logs
        {
          name: '3.3 System Error Logs',
          item: [
            {
              name: 'List System Error Logs',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/super-admin/errors?status=UNRESOLVED&limit=20',
                  host: ['{{baseUrl}}'],
                  path: ['super-admin', 'errors'],
                  query: [
                    { key: 'status', value: 'UNRESOLVED' },
                    { key: 'limit', value: '20' }
                  ]
                },
                description: 'Lists production error logs with stack traces, HTTP status, and tenant context.'
              }
            },
            {
              name: 'Get Error Log Details by ID',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/super-admin/errors/{{errorLogId}}',
                  host: ['{{baseUrl}}'],
                  path: ['super-admin', 'errors', '{{errorLogId}}']
                },
                description: 'Retrieves full stack trace, request body, and header context for an error log.'
              }
            },
            {
              name: 'Resolve Error Log',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    resolutionNotes: 'Patched payload parsing in webhooks controller. Verified in staging.'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/super-admin/errors/{{errorLogId}}/resolve',
                  host: ['{{baseUrl}}'],
                  path: ['super-admin', 'errors', '{{errorLogId}}', 'resolve']
                },
                description: 'Marks an error log as RESOLVED with audit note.'
              }
            }
          ]
        }
      ]
    },

    // -------------------------------------------------------------------------
    // FOLDER 4: Salon Admin
    // -------------------------------------------------------------------------
    {
      name: '4. Salon Admin Operations',
      description: 'Day-to-day salon operations: working hours, staff roster, leaves, breaks, closures, appointments, and CRM.',
      item: [
        // 4.1 Salon Profile
        {
          name: '4.1 Salon Profile & Settings',
          item: [
            {
              name: 'Get Salon Profile',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/profile',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'profile']
                },
                description: 'Retrieves current salon details, address, coordinates, category, and operating parameters.'
              }
            },
            {
              name: 'Update Salon Profile',
              request: {
                method: 'PUT',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Glamour Studio Luxury Lounge',
                    phone: '9876543210',
                    email: 'contact@glamourstudio.com',
                    address: 'Shop 12, High Street Mall, Linking Road',
                    city: 'Mumbai',
                    state: 'Maharashtra',
                    country: 'India',
                    latitude: 19.0657,
                    longitude: 72.8340,
                    googleMapsUrl: 'https://maps.google.com/?q=19.0657,72.8340',
                    locationType: 'VERIFIED',
                    timezone: 'Asia/Kolkata',
                    description: 'Premier bespoke hairstyling, beauty aesthetics, and luxury salon experience.'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/salons/profile',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'profile']
                },
                description: 'Updates salon metadata, address, geolocation, and description.'
              }
            },
            {
              name: 'Update WhatsApp Config',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    phoneNumberId: '109876543210987',
                    wabaId: '123456789012345',
                    accessToken: 'EAA...'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/salons/{{salonId}}/whatsapp-config',
                  host: ['{{baseUrl}}'],
                  path: ['salons', '{{salonId}}', 'whatsapp-config']
                },
                description: 'Configures custom Meta Cloud API credentials for tenant salon.'
              }
            }
          ]
        },

        // 4.2 Operating & Working Hours
        {
          name: '4.2 Operating & Working Hours',
          item: [
            {
              name: 'Get Salon Facility Working Hours',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/working-hours',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'working-hours']
                },
                description: 'Retrieves weekly opening/closing times for all 7 days with active staff count per day.'
              }
            },
            {
              name: 'Update Salon Facility Working Hours',
              request: {
                method: 'PUT',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    hours: [
                      { dayOfWeek: 'MONDAY', isClosed: false, startTime: '10:00', endTime: '20:00' },
                      { dayOfWeek: 'TUESDAY', isClosed: false, startTime: '10:00', endTime: '20:00' },
                      { dayOfWeek: 'WEDNESDAY', isClosed: false, startTime: '10:00', endTime: '20:00' },
                      { dayOfWeek: 'THURSDAY', isClosed: false, startTime: '10:00', endTime: '20:00' },
                      { dayOfWeek: 'FRIDAY', isClosed: false, startTime: '10:00', endTime: '21:00' },
                      { dayOfWeek: 'SATURDAY', isClosed: false, startTime: '09:00', endTime: '21:00' },
                      { dayOfWeek: 'SUNDAY', isClosed: false, startTime: '09:00', endTime: '21:00' }
                    ]
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/salons/working-hours',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'working-hours']
                },
                description: 'Updates salon facility operating hours across all 7 days and syncs non-customized staff.'
              }
            },
            {
              name: 'Get Staff Working Hours',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/working-hours',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'working-hours']
                },
                description: 'Retrieves weekly shifts and boundary status for a specific stylist.'
              }
            },
            {
              name: 'Update Staff Full Weekly Working Hours',
              request: {
                method: 'PUT',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    followsSalonSchedule: false,
                    hours: [
                      { dayOfWeek: 'MONDAY', isWorking: true, isCustomized: true, startTime: '10:00', endTime: '18:00' },
                      { dayOfWeek: 'TUESDAY', isWorking: false, isCustomized: true, startTime: '10:00', endTime: '18:00' },
                      { dayOfWeek: 'WEDNESDAY', isWorking: true, isCustomized: true, startTime: '10:00', endTime: '18:00' },
                      { dayOfWeek: 'THURSDAY', isWorking: true, isCustomized: true, startTime: '10:00', endTime: '18:00' },
                      { dayOfWeek: 'FRIDAY', isWorking: true, isCustomized: true, startTime: '10:00', endTime: '18:00' },
                      { dayOfWeek: 'SATURDAY', isWorking: true, isCustomized: true, startTime: '10:00', endTime: '19:00' },
                      { dayOfWeek: 'SUNDAY', isWorking: true, isCustomized: true, startTime: '10:00', endTime: '19:00' }
                    ]
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/working-hours',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'working-hours']
                },
                description: 'Updates full customized weekly shift schedule for a staff member.'
              }
            },
            {
              name: 'Patch Staff Single Day Shift (Weekly Off / Working)',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    isWorking: false,
                    isCustomized: true
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/working-hours/TUESDAY',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'working-hours', 'TUESDAY']
                },
                description: 'Quickly marks a specific day as Weekly Off or updates single day working hours.'
              }
            },
            {
              name: 'Reset Staff Working Hours to Salon Schedule',
              request: {
                method: 'POST',
                header: [],
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/working-hours/reset',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'working-hours', 'reset']
                },
                description: 'Clears custom shifts and re-syncs specialist schedule to mirror salon hours.'
              }
            }
          ]
        },

        // 4.3 Calendar, Closures & Festivals
        {
          name: '4.3 Calendar, Closures & Holidays',
          item: [
            {
              name: 'Get Calendar Schedule (SALON Scope - All Leaves & Closures)',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/closures/calendar-schedule?month=2026-10&calendarFor=SALON',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'closures', 'calendar-schedule'],
                  query: [
                    { key: 'month', value: '2026-10' },
                    { key: 'calendarFor', value: 'SALON' }
                  ]
                },
                description: 'Returns integrated monthly calendar data: salon working hours, store closures, all specialist leaves, and gazetted festivals.'
              }
            },
            {
              name: 'Get Calendar Schedule (STAFF Scope - Specific Stylist)',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/closures/calendar-schedule?month=2026-10&calendarFor=STAFF&staffId={{staffId}}',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'closures', 'calendar-schedule'],
                  query: [
                    { key: 'month', value: '2026-10' },
                    { key: 'calendarFor', value: 'STAFF' },
                    { key: 'staffId', value: '{{staffId}}' }
                  ]
                },
                description: 'Returns calendar data scoped exclusively to one specialist: their leaves, shifts, salon closures, and festivals.'
              }
            },
            {
              name: 'Get Indian Gazetted Holidays List',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/closures/holidays?year=2026&month=10',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'closures', 'holidays'],
                  query: [
                    { key: 'year', value: '2026' },
                    { key: 'month', value: '10' }
                  ]
                },
                description: 'Fetches recognized Indian festivals and public holidays for the specified month/year.'
              }
            },
            {
              name: 'List Salon Closures',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/closures',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'closures']
                },
                description: 'Lists all scheduled salon holidays, emergency closures, and maintenance days.'
              }
            },
            {
              name: 'Create Salon Closure (Store Day Off / Emergency)',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (jsonData.id) pm.collectionVariables.set("closureId", jsonData.id);'
                    ]
                  }
                }
              ],
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    closureType: 'HOLIDAY',
                    startDate: '2026-11-01',
                    endDate: '2026-11-02',
                    reason: 'Diwali Festival Holidays',
                    notes: 'Salon completely closed for staff celebrations'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/salons/closures',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'closures']
                },
                description: 'Schedules a salon closure. Automatically blocks bookings and cancels conflicting appointments.'
              }
            },
            {
              name: 'Delete Salon Closure (Reopen Store)',
              request: {
                method: 'DELETE',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/closures/{{closureId}}',
                  host: ['{{baseUrl}}'],
                  path: ['salons', 'closures', '{{closureId}}']
                },
                description: 'Reopens the salon by removing a scheduled closure.'
              }
            }
          ]
        },

        // 4.4 Facility & Staff Breaks
        {
          name: '4.4 Facility & Staff Breaks',
          item: [
            {
              name: 'Facility Breaks',
              item: [
                {
                  name: 'Get All Salon Facility Breaks',
                  request: {
                    method: 'GET',
                    header: [],
                    url: {
                      raw: '{{baseUrl}}/salons/breaks',
                      host: ['{{baseUrl}}'],
                      path: ['salons', 'breaks']
                    },
                    description: 'Lists all salon facility breaks grouped by routine patterns and by day.'
                  }
                },
                {
                  name: 'Create Facility Break (Single or Multi-Day)',
                  event: [
                    {
                      listen: 'test',
                      script: {
                        type: 'text/javascript',
                        exec: [
                          'var jsonData = pm.response.json();',
                          'if (jsonData.id) pm.collectionVariables.set("breakId", jsonData.id);',
                          'if (jsonData.routineBreakId) pm.collectionVariables.set("routineBreakId", jsonData.routineBreakId);'
                        ]
                      }
                    }
                  ],
                  request: {
                    method: 'POST',
                    header: [{ key: 'Content-Type', value: 'application/json' }],
                    body: {
                      mode: 'raw',
                      raw: JSON.stringify({
                        title: 'Lunch Hour',
                        startTime: '13:00',
                        endTime: '14:00',
                        days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
                      }, null, 2)
                    },
                    url: {
                      raw: '{{baseUrl}}/salons/breaks',
                      host: ['{{baseUrl}}'],
                      path: ['salons', 'breaks']
                    },
                    description: 'Creates facility-wide lunch or tea break across selected days.'
                  }
                },
                {
                  name: 'Update Routine Facility Break',
                  request: {
                    method: 'PUT',
                    header: [{ key: 'Content-Type', value: 'application/json' }],
                    body: {
                      mode: 'raw',
                      raw: JSON.stringify({
                        routineBreakId: '{{routineBreakId}}',
                        title: 'Extended Afternoon Lunch Break',
                        startTime: '13:30',
                        endTime: '14:30',
                        days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
                      }, null, 2)
                    },
                    url: {
                      raw: '{{baseUrl}}/salons/breaks/routine',
                      host: ['{{baseUrl}}'],
                      path: ['salons', 'breaks', 'routine']
                    },
                    description: 'Updates a recurring routine break pattern across its active days.'
                  }
                },
                {
                  name: 'Delete Routine Facility Break',
                  request: {
                    method: 'DELETE',
                    header: [{ key: 'Content-Type', value: 'application/json' }],
                    body: {
                      mode: 'raw',
                      raw: JSON.stringify({
                        routineBreakId: '{{routineBreakId}}'
                      }, null, 2)
                    },
                    url: {
                      raw: '{{baseUrl}}/salons/breaks/routine',
                      host: ['{{baseUrl}}'],
                      path: ['salons', 'breaks', 'routine']
                    },
                    description: 'Removes all days belonging to a routine facility break pattern.'
                  }
                },
                {
                  name: 'Update Single Facility Break by ID',
                  request: {
                    method: 'PUT',
                    header: [{ key: 'Content-Type', value: 'application/json' }],
                    body: {
                      mode: 'raw',
                      raw: JSON.stringify({
                        title: 'Quick Power Break',
                        startTime: '16:00',
                        endTime: '16:30'
                      }, null, 2)
                    },
                    url: {
                      raw: '{{baseUrl}}/salons/breaks/{{breakId}}',
                      host: ['{{baseUrl}}'],
                      path: ['salons', 'breaks', '{{breakId}}']
                    },
                    description: 'Updates an individual break instance.'
                  }
                },
                {
                  name: 'Delete Single Facility Break by ID',
                  request: {
                    method: 'DELETE',
                    header: [],
                    url: {
                      raw: '{{baseUrl}}/salons/breaks/{{breakId}}',
                      host: ['{{baseUrl}}'],
                      path: ['salons', 'breaks', '{{breakId}}']
                    },
                    description: 'Deletes an individual facility break.'
                  }
                }
              ]
            },
            {
              name: 'Specialist Staff Breaks',
              item: [
                {
                  name: 'Get Staff Breaks',
                  request: {
                    method: 'GET',
                    header: [],
                    url: {
                      raw: '{{baseUrl}}/staff/{{staffId}}/breaks',
                      host: ['{{baseUrl}}'],
                      path: ['staff', '{{staffId}}', 'breaks']
                    },
                    description: 'Returns all breaks for a stylist (custom overrides + inherited salon facility breaks).'
                  }
                },
                {
                  name: 'Inherit Salon Facility Break for Staff',
                  request: {
                    method: 'POST',
                    header: [{ key: 'Content-Type', value: 'application/json' }],
                    body: {
                      mode: 'raw',
                      raw: JSON.stringify({
                        salonBreakId: '{{breakId}}'
                      }, null, 2)
                    },
                    url: {
                      raw: '{{baseUrl}}/staff/{{staffId}}/breaks/inherit',
                      host: ['{{baseUrl}}'],
                      path: ['staff', '{{staffId}}', 'breaks', 'inherit']
                    },
                    description: 'Applies an available facility break to a specialist schedule.'
                  }
                },
                {
                  name: 'Create Custom Staff Break',
                  request: {
                    method: 'POST',
                    header: [{ key: 'Content-Type', value: 'application/json' }],
                    body: {
                      mode: 'raw',
                      raw: JSON.stringify({
                        title: 'Personal Rest Break',
                        startTime: '15:00',
                        endTime: '15:45',
                        days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
                        autoReschedule: true
                      }, null, 2)
                    },
                    url: {
                      raw: '{{baseUrl}}/staff/{{staffId}}/breaks',
                      host: ['{{baseUrl}}'],
                      path: ['staff', '{{staffId}}', 'breaks']
                    },
                    description: 'Creates customized break times specific to one stylist.'
                  }
                },
                {
                  name: 'Reset Staff Break to Facility Default',
                  request: {
                    method: 'POST',
                    header: [],
                    url: {
                      raw: '{{baseUrl}}/staff/{{staffId}}/breaks/{{breakId}}/reset',
                      host: ['{{baseUrl}}'],
                      path: ['staff', '{{staffId}}', 'breaks', '{{breakId}}', 'reset']
                    },
                    description: 'Removes stylist override and reverts to salon facility break timing.'
                  }
                },
                {
                  name: 'Delete Staff Break',
                  request: {
                    method: 'DELETE',
                    header: [],
                    url: {
                      raw: '{{baseUrl}}/staff/{{staffId}}/breaks/{{breakId}}',
                      host: ['{{baseUrl}}'],
                      path: ['staff', '{{staffId}}', 'breaks', '{{breakId}}']
                    },
                    description: 'Deletes a customized break from stylist schedule.'
                  }
                }
              ]
            }
          ]
        },

        // 4.5 Staff & Specialist Management
        {
          name: '4.5 Staff Management & Leaves',
          item: [
            {
              name: 'List All Staff',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (Array.isArray(jsonData) && jsonData.length > 0) {',
                      '  pm.collectionVariables.set("staffId", jsonData[0].id);',
                      '}'
                    ]
                  }
                }
              ],
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/staff',
                  host: ['{{baseUrl}}'],
                  path: ['staff']
                },
                description: 'Lists all staff members, their working shifts, assigned services, and active absence status.'
              }
            },
            {
              name: 'Create Staff Member',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (jsonData.id) pm.collectionVariables.set("staffId", jsonData.id);'
                    ]
                  }
                }
              ],
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Rohan Sharma',
                    phone: '9811223344',
                    email: 'rohan.sharma@example.com',
                    profileImageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
                    serviceIds: ['{{serviceId}}'],
                    followsSalonSchedule: true
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/staff',
                  host: ['{{baseUrl}}'],
                  path: ['staff']
                },
                description: 'Creates a new specialist / stylist for the salon.'
              }
            },
            {
              name: 'Get Staff Details by ID',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}']
                },
                description: 'Retrieves staff profile, assigned services, working hours, and recent leaves.'
              }
            },
            {
              name: 'Update Staff Profile',
              request: {
                method: 'PUT',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Rohan Sharma (Master Stylist)',
                    phone: '9811223344',
                    email: 'rohan.master@example.com',
                    followsSalonSchedule: false
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}']
                },
                description: 'Updates basic details for a staff member.'
              }
            },
            {
              name: 'Assign Services to Staff',
              request: {
                method: 'PUT',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    serviceIds: ['{{serviceId}}']
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/services',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'services']
                },
                description: 'Assigns the specific salon services this stylist can perform.'
              }
            },
            {
              name: 'Preview Leave Impact (Check Conflicting Appointments)',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/leaves/preview?startDate=2026-10-25&endDate=2026-10-26&leavePortion=FULL_DAY',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'leaves', 'preview'],
                  query: [
                    { key: 'startDate', value: '2026-10-25' },
                    { key: 'endDate', value: '2026-10-26' },
                    { key: 'leavePortion', value: 'FULL_DAY' }
                  ]
                },
                description: 'Scans appointments on the requested leave dates and returns conflicting bookings that need reassignment or cancellation.'
              }
            },
            {
              name: 'Apply Specialist Leave',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    startDate: '2026-10-25',
                    endDate: '2026-10-26',
                    leavePortion: 'FULL_DAY',
                    leaveType: 'CASUAL_LEAVE',
                    reason: 'Attending family wedding',
                    notes: 'Approved by salon manager'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/leaves',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'leaves']
                },
                description: 'Schedules a leave or marks stylist absent. Automatically notifies affected customers.'
              }
            },
            {
              name: 'Get Staff Leave History',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/leaves?startDate=2026-10-01&endDate=2026-10-31',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'leaves'],
                  query: [
                    { key: 'startDate', value: '2026-10-01' },
                    { key: 'endDate', value: '2026-10-31' }
                  ]
                },
                description: 'Lists all approved, past, and upcoming leave records for a specialist.'
              }
            },
            {
              name: 'Extend Specialist Leave',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    newEndDate: '2026-10-27',
                    reason: 'Train delayed, extended by 1 day'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/leaves/{{leaveId}}/extend',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'leaves', '{{leaveId}}', 'extend']
                },
                description: 'Extends an active leave date and checks for newly conflicting bookings.'
              }
            },
            {
              name: 'Cancel Specialist Leave',
              request: {
                method: 'DELETE',
                header: [],
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}/leaves/{{leaveId}}',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}', 'leaves', '{{leaveId}}']
                },
                description: 'Cancels leave and restores specialist availability.'
              }
            },
            {
              name: 'Delete Staff Member',
              request: {
                method: 'DELETE',
                header: [],
                url: {
                  raw: '{{baseUrl}}/staff/{{staffId}}',
                  host: ['{{baseUrl}}'],
                  path: ['staff', '{{staffId}}']
                },
                description: 'Deactivates and removes staff member from salon roster.'
              }
            }
          ]
        },

        // 4.6 Services & Categories
        {
          name: '4.6 Services & Categories',
          item: [
            {
              name: 'List Service Categories',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (Array.isArray(jsonData) && jsonData.length > 0) {',
                      '  pm.collectionVariables.set("categoryId", jsonData[0].id);',
                      '}'
                    ]
                  }
                }
              ],
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/services/categories',
                  host: ['{{baseUrl}}'],
                  path: ['services', 'categories']
                },
                description: 'Lists all service categories created by this salon.'
              }
            },
            {
              name: 'Create Service Category',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (jsonData.id) pm.collectionVariables.set("categoryId", jsonData.id);'
                    ]
                  }
                }
              ],
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Hair Spa & Keratin Therapy',
                    icon: '💆‍♀️',
                    sortOrder: 1
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/services/categories',
                  host: ['{{baseUrl}}'],
                  path: ['services', 'categories']
                },
                description: 'Creates a category under which services are listed.'
              }
            },
            {
              name: 'Update Service Category',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Premium Hair Spa & Rebonding',
                    icon: '✨',
                    sortOrder: 2
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/services/categories/{{categoryId}}',
                  host: ['{{baseUrl}}'],
                  path: ['services', 'categories', '{{categoryId}}']
                },
                description: 'Updates category name or sort order.'
              }
            },
            {
              name: 'Delete Service Category',
              request: {
                method: 'DELETE',
                header: [],
                url: {
                  raw: '{{baseUrl}}/services/categories/{{categoryId}}',
                  host: ['{{baseUrl}}'],
                  path: ['services', 'categories', '{{categoryId}}']
                },
                description: 'Deletes a category.'
              }
            },
            {
              name: 'List Salon Services',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (Array.isArray(jsonData) && jsonData.length > 0) {',
                      '  pm.collectionVariables.set("serviceId", jsonData[0].id);',
                      '}'
                    ]
                  }
                }
              ],
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/services',
                  host: ['{{baseUrl}}'],
                  path: ['services']
                },
                description: 'Lists all services configured in this salon.'
              }
            },
            {
              name: 'Get Service Details by ID',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/services/{{serviceId}}',
                  host: ['{{baseUrl}}'],
                  path: ['services', '{{serviceId}}']
                },
                description: 'Retrieves service pricing, duration, and assigned staff.'
              }
            },
            {
              name: 'Create Service',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (jsonData.id) pm.collectionVariables.set("serviceId", jsonData.id);'
                    ]
                  }
                }
              ],
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Signature Moroccan Oil Hair Spa',
                    description: 'Deep nourishing treatment with scalp massage and hair mask',
                    price: 1800,
                    durationMinutes: 60,
                    category: 'Hair Spa & Keratin Therapy',
                    categoryId: '{{categoryId}}',
                    gender: 'UNISEX',
                    staffIds: ['{{staffId}}']
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/services',
                  host: ['{{baseUrl}}'],
                  path: ['services']
                },
                description: 'Creates a new bookable service with 15-min multiple duration.'
              }
            },
            {
              name: 'Update Service',
              request: {
                method: 'PUT',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    name: 'Signature Moroccan Oil Hair Spa (Deluxe)',
                    price: 2000,
                    durationMinutes: 75,
                    gender: 'UNISEX'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/services/{{serviceId}}',
                  host: ['{{baseUrl}}'],
                  path: ['services', '{{serviceId}}']
                },
                description: 'Updates price, duration, or assigned category.'
              }
            },
            {
              name: 'Toggle Service Active Status',
              request: {
                method: 'PATCH',
                header: [],
                url: {
                  raw: '{{baseUrl}}/services/{{serviceId}}/toggle-status',
                  host: ['{{baseUrl}}'],
                  path: ['services', '{{serviceId}}', 'toggle-status']
                },
                description: 'Toggles service between active and paused.'
              }
            },
            {
              name: 'Delete Service',
              request: {
                method: 'DELETE',
                header: [],
                url: {
                  raw: '{{baseUrl}}/services/{{serviceId}}',
                  host: ['{{baseUrl}}'],
                  path: ['services', '{{serviceId}}']
                },
                description: 'Deletes service from salon catalog.'
              }
            }
          ]
        },

        // 4.7 Appointments & Queue
        {
          name: '4.7 Appointments & Queue Management',
          item: [
            {
              name: 'Get Appointments (Filter by Date / Staff / Status)',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'var list = Array.isArray(jsonData) ? jsonData : (jsonData.data || []);',
                      'if (list.length > 0) {',
                      '  pm.collectionVariables.set("appointmentId", list[0].id);',
                      '}'
                    ]
                  }
                }
              ],
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/appointments?date=2026-10-19',
                  host: ['{{baseUrl}}'],
                  path: ['appointments'],
                  query: [
                    { key: 'date', value: '2026-10-19' },
                    { key: 'status', value: 'BOOKED', disabled: true },
                    { key: 'staffId', value: '{{staffId}}', disabled: true }
                  ]
                },
                description: 'Retrieves all appointments matching filter parameters for live salon dashboard.'
              }
            },
            {
              name: 'Get Appointment by ID',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/appointments/{{appointmentId}}',
                  host: ['{{baseUrl}}'],
                  path: ['appointments', '{{appointmentId}}']
                },
                description: 'Retrieves full details of an appointment including customer phone, strikes, and timing.'
              }
            },
            {
              name: 'Create Salon Appointment (Admin Walk-In / Phone Booking)',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'if (jsonData.id) pm.collectionVariables.set("appointmentId", jsonData.id);'
                    ]
                  }
                }
              ],
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    date: '2026-10-19',
                    startTime: '14:00',
                    serviceId: '{{serviceId}}',
                    stylistId: '{{staffId}}',
                    customerName: 'Ananya Deshmukh',
                    customerPhone: '9876543210',
                    customerEmail: 'ananya@example.com',
                    source: 'WALK_IN',
                    notes: 'Prefers mild shampoo'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/appointments',
                  host: ['{{baseUrl}}'],
                  path: ['appointments']
                },
                description: 'Creates an appointment directly from dashboard.'
              }
            },
            {
              name: 'Update Appointment Status (Queue Flow)',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    status: 'CHECKED_IN',
                    reason: 'Client arrived at reception'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/appointments/{{appointmentId}}/status',
                  host: ['{{baseUrl}}'],
                  path: ['appointments', '{{appointmentId}}', 'status']
                },
                description: 'Advances appointment through queue lifecycle: BOOKED -> CHECKED_IN -> SEATED_IN_CHAIR -> COMPLETED or NO_SHOW.'
              }
            },
            {
              name: 'Cancel Booking (With Penalty & Fault Context)',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    source: 'ADMIN_DASHBOARD',
                    fault: 'CLIENT',
                    reason: 'Customer called and requested last-minute cancellation',
                    reasonCategory: 'CLIENT_MISTAKE',
                    applyPenalty: false
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/appointments/{{appointmentId}}/cancel',
                  host: ['{{baseUrl}}'],
                  path: ['appointments', '{{appointmentId}}', 'cancel']
                },
                description: 'Cancels booking with audit context. Calculates strikes and dispatches Smart Move-Up broadcast if eligible.'
              }
            },
            {
              name: 'Reschedule Appointment',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    newDate: '2026-10-20',
                    newStartTime: '16:00',
                    stylistId: '{{staffId}}'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/appointments/{{appointmentId}}/reschedule',
                  host: ['{{baseUrl}}'],
                  path: ['appointments', '{{appointmentId}}', 'reschedule']
                },
                description: 'Directly moves an appointment to a new date and time.'
              }
            },
            {
              name: 'Propose Admin Reschedule to Client',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    newStartAt: '2026-10-20T16:00:00.000Z',
                    newEndAt: '2026-10-20T17:00:00.000Z',
                    proposedStylistId: '{{staffId}}'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/appointments/{{appointmentId}}/propose-reschedule',
                  host: ['{{baseUrl}}'],
                  path: ['appointments', '{{appointmentId}}', 'propose-reschedule']
                },
                description: 'Sends interactive WhatsApp reschedule proposal to client with 30-minute confirmation button.'
              }
            },
            {
              name: 'Trigger 10-Minute Reminder Cron Tick',
              request: {
                auth: { type: 'noauth' },
                method: 'POST',
                header: [],
                url: {
                  raw: '{{baseUrl}}/appointments/reminders/tick',
                  host: ['{{baseUrl}}'],
                  path: ['appointments', 'reminders', 'tick']
                },
                description: 'Cron trigger that processes 2-hour and 10-minute reminders and enforces grace period auto-cancellations.'
              }
            },
            {
              name: 'Realtime SSE Event Stream',
              request: {
                auth: { type: 'noauth' },
                method: 'GET',
                header: [
                  { key: 'Accept', value: 'text/event-stream' }
                ],
                url: {
                  raw: '{{baseUrl}}/appointments/stream/{{salonId}}',
                  host: ['{{baseUrl}}'],
                  path: ['appointments', 'stream', '{{salonId}}']
                },
                description: 'Server-Sent Events (SSE) stream for live updates to the dashboard.'
              }
            }
          ]
        },

        // 4.8 Customers CRM & Strikes
        {
          name: '4.8 Customers CRM & Penalty Management',
          item: [
            {
              name: 'List Customers',
              event: [
                {
                  listen: 'test',
                  script: {
                    type: 'text/javascript',
                    exec: [
                      'var jsonData = pm.response.json();',
                      'var list = Array.isArray(jsonData) ? jsonData : (jsonData.customers || []);',
                      'if (list.length > 0) {',
                      '  pm.collectionVariables.set("customerId", list[0].id);',
                      '}'
                    ]
                  }
                }
              ],
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/customers?search=Ananya&page=1&limit=20',
                  host: ['{{baseUrl}}'],
                  path: ['customers'],
                  query: [
                    { key: 'search', value: 'Ananya' },
                    { key: 'page', value: '1' },
                    { key: 'limit', value: '20' }
                  ]
                },
                description: 'Searches customer directory with penalty strike counts and booking frequency.'
              }
            },
            {
              name: 'Get Customer Profile & Booking History',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/customers/{{customerId}}',
                  host: ['{{baseUrl}}'],
                  path: ['customers', '{{customerId}}']
                },
                description: 'Retrieves full customer dossier, past appointments, no-shows, and block state.'
              }
            },
            {
              name: 'Unblock Customer Account',
              request: {
                method: 'PATCH',
                header: [],
                url: {
                  raw: '{{baseUrl}}/customers/{{customerId}}/unblock',
                  host: ['{{baseUrl}}'],
                  path: ['customers', '{{customerId}}', 'unblock']
                },
                description: 'Unlocks a customer blocked due to 3 consecutive no-shows.'
              }
            },
            {
              name: 'Update Customer Strikes / Block State',
              request: {
                method: 'PATCH',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    yearlyNoShowCount: 1,
                    isBookingBlocked: false
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/customers/{{customerId}}/strikes',
                  host: ['{{baseUrl}}'],
                  path: ['customers', '{{customerId}}', 'strikes']
                },
                description: 'Manually adjusts strike count or booking block status.'
              }
            }
          ]
        },

        // 4.9 Quick Booking Code
        {
          name: '4.9 Quick Booking Code',
          item: [
            {
              name: 'Get Today\'s Quick Code',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/{{salonId}}/quick-code',
                  host: ['{{baseUrl}}'],
                  path: ['salons', '{{salonId}}', 'quick-code']
                },
                description: 'Returns today\'s 4-digit salon counter quick code for walk-in QR check-ins.'
              }
            },
            {
              name: 'Regenerate Today\'s Quick Code',
              request: {
                method: 'POST',
                header: [],
                url: {
                  raw: '{{baseUrl}}/salons/{{salonId}}/quick-code/generate',
                  host: ['{{baseUrl}}'],
                  path: ['salons', '{{salonId}}', 'quick-code', 'generate']
                },
                description: 'Forces regeneration of a new 4-digit quick code.'
              }
            }
          ]
        },

        // 4.10 Reports & Analytics
        {
          name: '4.10 Reports & Analytics',
          item: [
            {
              name: 'Get Dashboard Summary & Metrics',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/reports/dashboard?date=2026-10-19',
                  host: ['{{baseUrl}}'],
                  path: ['reports', 'dashboard'],
                  query: [
                    { key: 'date', value: '2026-10-19' }
                  ]
                },
                description: 'Returns total appointments, revenue, status distribution, and staff performance metrics.'
              }
            }
          ]
        }
      ]
    },

    // -------------------------------------------------------------------------
    // FOLDER 5: Client Channels (Public Booking & WhatsApp)
    // -------------------------------------------------------------------------
    {
      name: '5. Client Channels & Messaging',
      description: 'End-customer touchpoints: Public web booking portal, Meta WhatsApp webhook engine, and two-way staff chat.',
      item: [
        // 5.1 Public Web Booking
        {
          name: '5.1 Public Web Booking Engine',
          item: [
            {
              name: 'Get Public Salon Info by Slug',
              request: {
                auth: { type: 'noauth' },
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/booking/{{salonSlug}}',
                  host: ['{{baseUrl}}'],
                  path: ['booking', '{{salonSlug}}']
                },
                description: 'Public endpoint consumed by client booking UI. Returns salon menu, specialists, and business hours.'
              }
            },
            {
              name: 'Check Available Time Slots',
              request: {
                auth: { type: 'noauth' },
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/booking/{{salonSlug}}/availability?serviceId={{serviceId}}&date=2026-10-20&staffId={{staffId}}',
                  host: ['{{baseUrl}}'],
                  path: ['booking', '{{salonSlug}}', 'availability'],
                  query: [
                    { key: 'serviceId', value: '{{serviceId}}' },
                    { key: 'date', value: '2026-10-20' },
                    { key: 'staffId', value: '{{staffId}}' }
                  ]
                },
                description: 'Calculates open time slots considering closures, working hours, breaks, and existing appointments.'
              }
            },
            {
              name: 'Create Public Appointment',
              request: {
                auth: { type: 'noauth' },
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    date: '2026-10-20',
                    startTime: '15:00',
                    serviceId: '{{serviceId}}',
                    stylistId: '{{staffId}}',
                    customerName: 'Priya Verma',
                    customerPhone: '9822334455',
                    customerEmail: 'priya.verma@example.com',
                    source: 'WEB',
                    notes: 'First time visit'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/booking/{{salonSlug}}/appointments',
                  host: ['{{baseUrl}}'],
                  path: ['booking', '{{salonSlug}}', 'appointments']
                },
                description: 'Creates a public client booking and triggers confirmation message.'
              }
            }
          ]
        },

        // 5.2 WhatsApp Channel
        {
          name: '5.2 WhatsApp Channel & Two-Way Chat',
          item: [
            {
              name: 'Meta Webhook Verification (Hub Challenge)',
              request: {
                auth: { type: 'noauth' },
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=salon_webhook_verify_token_mvp&hub.challenge=1158201444',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'webhook'],
                  query: [
                    { key: 'hub.mode', value: 'subscribe' },
                    { key: 'hub.verify_token', value: 'salon_webhook_verify_token_mvp' },
                    { key: 'hub.challenge', value: '1158201444' }
                  ]
                },
                description: 'Webhook verification handshake requested by Meta Cloud API.'
              }
            },
            {
              name: 'Meta Inbound Webhook Payload',
              request: {
                auth: { type: 'noauth' },
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    object: 'whatsapp_business_account',
                    entry: [
                      {
                        id: '123456789012345',
                        changes: [
                          {
                            value: {
                              messaging_product: 'whatsapp',
                              metadata: {
                                display_phone_number: '919811122233',
                                phone_number_id: '109876543210987'
                              },
                              messages: [
                                {
                                  from: '919876543210',
                                  id: 'wamid.HBgLM...',
                                  timestamp: '1697712000',
                                  text: { body: 'Book haircut' },
                                  type: 'text'
                                }
                              ]
                            },
                            field: 'messages'
                          }
                        ]
                      }
                    ]
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/whatsapp/webhook',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'webhook']
                },
                description: 'Ingests inbound client messages and delivery status receipts.'
              }
            },
            {
              name: 'Simulate WhatsApp Message (Browser Testing)',
              request: {
                auth: { type: 'noauth' },
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    salonSlug: '{{salonSlug}}',
                    customerPhone: '+919876543210',
                    messageText: 'Hi, I want to book an appointment'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/whatsapp/simulate',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'simulate']
                },
                description: 'Simulates WhatsApp bot conversation without requiring active Meta credentials.'
              }
            },
            {
              name: 'Get WhatsApp Audit Logs',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/whatsapp/logs?phone=9876543210&limit=50',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'logs'],
                  query: [
                    { key: 'phone', value: '9876543210' },
                    { key: 'limit', value: '50' }
                  ]
                },
                description: 'Fetches delivery receipts and message logs from whatsapp_logs table.'
              }
            },
            {
              name: 'Get WhatsApp Connection Status',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/whatsapp/status?salonId={{salonId}}',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'status'],
                  query: [
                    { key: 'salonId', value: '{{salonId}}' }
                  ]
                },
                description: 'Checks whether salon is connected to Meta Cloud API.'
              }
            },
            {
              name: 'Two-Way Staff Chat: Send Message to Client',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    salonId: '{{salonId}}',
                    customerPhone: '+919876543210',
                    messageText: 'Hello Ananya, our stylist is ready for your appointment!'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/whatsapp/chat/send-message',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'chat', 'send-message']
                },
                description: 'Sends direct message from salon staff to client. Pauses automated bot.'
              }
            },
            {
              name: 'Two-Way Staff Chat: Resume AI Bot',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    salonId: '{{salonId}}',
                    customerPhone: '+919876543210'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/whatsapp/chat/resume-bot',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'chat', 'resume-bot']
                },
                description: 'Resumes automated AI bot after staff finishes manual interaction.'
              }
            },
            {
              name: 'Two-Way Staff Chat: Get Conversation History',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: '{{baseUrl}}/whatsapp/chat/history?salonId={{salonId}}&customerPhone=+919876543210',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'chat', 'history'],
                  query: [
                    { key: 'salonId', value: '{{salonId}}' },
                    { key: 'customerPhone', value: '+919876543210' }
                  ]
                },
                description: 'Retrieves complete WhatsApp chat thread between salon and customer.'
              }
            },
            {
              name: 'Meta Embedded Signup Connect',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    salonId: '{{salonId}}',
                    phoneNumberId: '109876543210987',
                    wabaId: '123456789012345',
                    displayPhoneNumber: '+91 98111 22233',
                    code: 'AQB...'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/whatsapp/embedded-signup/connect',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'embedded-signup', 'connect']
                },
                description: 'Completes Meta Embedded Signup OAuth flow.'
              }
            },
            {
              name: 'Disconnect WhatsApp Account',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                body: {
                  mode: 'raw',
                  raw: JSON.stringify({
                    salonId: '{{salonId}}'
                  }, null, 2)
                },
                url: {
                  raw: '{{baseUrl}}/whatsapp/disconnect',
                  host: ['{{baseUrl}}'],
                  path: ['whatsapp', 'disconnect']
                },
                description: 'Disconnects WhatsApp Cloud API account from salon.'
              }
            }
          ]
        }
      ]
    }
  ]
};

const outputPaths = [
  path.join(__dirname, 'StyleSlot_Backend_API.postman_collection.json'),
  path.join(__dirname, '..', 'StyleSlot_Backend_API.postman_collection.json')
];

for (const outPath of outputPaths) {
  fs.writeFileSync(outPath, JSON.stringify(collection, null, 2), 'utf-8');
  console.log(`Saved Postman collection to: ${outPath}`);
}
