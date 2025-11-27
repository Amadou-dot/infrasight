import FloorPlan from '@/components/FloorPlan';
import AnomalyChart from '@/components/AnomalyChart';
import DeviceGrid from '@/components/DeviceGrid';

export default function Home() {
  return (
    <main className='min-h-screen bg-gray-100 p-8 font-sans'>
      <header className='mb-8'>
        <h1 className='text-3xl font-bold text-gray-900 tracking-tight'>
          IoT Building Monitor
        </h1>
        <p className='text-gray-500 mt-1'>
          Real-time sensor data and analytics for Denver HQ
        </p>
      </header>

      <div className='grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8'>
        <FloorPlan />
        <AnomalyChart />
      </div>

      <div className='w-full'>
        <DeviceGrid />
      </div>
    </main>
  );
}
