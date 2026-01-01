<p>
  <img src="https://raw.githubusercontent.com/Amadou-dot/Amadou-dot/main/assets/banners/infrasight-banner.png">
</p>

<h1>🏢 Infrasight – Real-Time IoT Building Monitoring Dashboard</h1>

<p>
  <a href="https://infrasight.aseck.dev/">
    <img src="https://img.shields.io/badge/Live%20Preview-000000?style=for-the-badge&logo=vercel&logoColor=white">
  </a>
  
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white">
  <img src="https://img.shields.io/badge/Pusher-300D4F?style=for-the-badge&logo=pusher&logoColor=white">
</p>

<p>
  A real-time IoT sensor monitoring dashboard for building management. Track environmental sensors across building floors and rooms with live updates, anomaly detection, and comprehensive device health monitoring.
</p>

---

## ✨ Features

- **Real-Time Monitoring**: Live sensor data updates via Pusher WebSocket connections
- **Device Health Tracking**: Monitor device status, uptime, battery levels, and signal strength
- **Anomaly Detection**: Automatic detection and alerting for unusual sensor readings
- **Floor Plan Visualization**: Interactive floor plans with device status indicators
- **Analytics Dashboard**: Energy analytics, health metrics, and trend visualization
- **Audit Trail**: Complete device change history with compliance tracking

## 🛠 Tech Stack

- **Frontend**: [Next.js 15](https://nextjs.org/) with [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/)
- **Backend**: [MongoDB](https://www.mongodb.com/) with [Mongoose](https://mongoosejs.com/) (timeseries collections), [Zod](https://zod.dev/) validation
- **Real-Time**: [Pusher](https://pusher.com/) for WebSocket connections
- **Tools**: [Recharts](https://recharts.org/) for data visualization, [Radix UI](https://www.radix-ui.com/) components, [shadcn/ui](https://ui.shadcn.com/)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB database (local or cloud)
- Pusher account for real-time features

### Installation

```bash
# Clone the repository
git clone https://github.com/Amadou-dot/infrasight.git
cd infrasight

# Install dependencies
pnpm install
```

### Environment Setup

1. Copy the example environment file:
```bash
cp example.env .env.local
```

2. Add your configuration to `.env.local`:
```env
# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/infrasight

# Pusher Channel Keys (Server-side)
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_key
PUSHER_SECRET=your_secret
PUSHER_CLUSTER=your_cluster

# Pusher Channel Keys (Client-side)
NEXT_PUBLIC_PUSHER_KEY=your_key
NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster
```

### Initialize & Run

```bash
# Create database indexes
pnpm create-indexes-v2

# Seed with test data (500 devices + readings)
pnpm seed

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## 📁 Project Structure

```
infrasight/
├── app/              # Next.js App Router pages and API routes
├── components/       # React components (dashboard, modals, charts)
├── lib/              # Utilities, API clients, validation schemas
├── models/           # Mongoose models (v1 and v2 schemas)
├── scripts/          # Database seeding and migration scripts
└── types/            # TypeScript type definitions
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p>
  Made by <a href="https://github.com/Amadou-dot">Amadou</a>
</p>
