import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { Background } from './components/Background';
import { Landing } from './pages/Landing';
import { Marketplace } from './pages/Marketplace';
import { AssetDetail } from './pages/AssetDetail';
import { SwapStudio } from './pages/SwapStudio';
import { Portfolio } from './pages/Portfolio';
import { Activity } from './pages/Activity';
import { useSeedMarket } from './hooks/useWalletData';

export default function App() {
  useSeedMarket();
  return (
    <div className="relative min-h-screen flex flex-col">
      <Background />
      <Header />
      <main className="relative z-10 flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/market" element={<Marketplace />} />
          <Route path="/asset/:id" element={<AssetDetail />} />
          <Route path="/swap" element={<SwapStudio />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/activity" element={<Activity />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
