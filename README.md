# Techloom POS & Inventory System - Backend

Backend service for the Techloom POS & Inventory System. This API
manages authentication, products, inventory, orders, payments,
reporting, and image uploads.

## Technology Stack

-   Node.js
-   Express.js
-   MongoDB / MongoDB Atlas
-   JWT Authentication
-   Supabase Storage
-   Render Deployment

## Features

### Authentication

-   User registration and login
-   JWT based authentication
-   Role based access control

### Product Management

-   Create, update, delete products
-   Product information management
-   Stock tracking

### Inventory Management

-   Stock monitoring
-   Stock adjustments
-   Reservation handling
-   Overselling prevention

### Order Management

-   Checkout process
-   Customer orders
-   Admin order management
-   Order status tracking
-   Sales reports

### Payment Management

-   Payment workflow
-   Payment status handling

### Image Upload

-   Product image upload
-   Supabase Storage integration

## Project Structure

    backend
    ├── controllers
    ├── models
    ├── routes
    ├── middleware
    ├── utils
    ├── config
    └── index.js

## Environment Variables

``` env
MONGO_URL=
JWT_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_BUCKET=
```

## Installation

``` bash
npm install
npm start
```

## API Modules

-   `/api/users` - Authentication and users
-   `/api/products` - Product and inventory management
-   `/api/orders` - Orders and reports
-   `/api/payments` - Payment handling
-   `/api/upload` - Image uploads

## Deployment

Backend: Render\
Database: MongoDB Atlas\
Storage: Supabase Storage

## Author

Gaurawa Mihiranga
