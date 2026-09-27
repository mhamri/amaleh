import { Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';
import { MetaProvider } from '@solidjs/meta';
import { onMount, Suspense } from 'solid-js';
import Header from './components/Header';
import Footer from './components/Footer';
import ConsentBanner from './components/ConsentBanner';
import StarCheck from './components/StarCheck';
import { Drifter, Glow, GridDots, LightRays, Reveal, Rings } from './components/decor';
import { startEngagedVisitTracking } from './lib/engaged-visit';
import './style.css';

export default function App() {
  onMount(() => {
    startEngagedVisitTracking();
  });

  return (
    <Router
      base={import.meta.env.BASE_URL}
      root={(props) => (
        <MetaProvider>
          <a class="skip-link" href="#main">Skip to content</a>

          <div class="decor-field fixed" aria-hidden="true" data-reveal>
            <GridDots hue="secondary" spacingPx={28} centreXFraction={0.82} centreYFraction={0} opacity={0.32} />
            <Glow hue="primary" diameterPx={880} centreXFraction={0.84} centreYFraction={-0.06} opacity={0.42} />
            <Rings hue="primary" diameterPx={560} centreXFraction={0.95} centreYFraction={-0.04} opacity={0.32} class="hidden sm:block" />
            <Drifter direction="vertical" distancePx={22}>
              <LightRays hue="primary" apexXFraction={0.84} apexYFraction={-0.08} spreadDegrees={122} opacity={0.32} />
            </Drifter>
            <Glow hue="secondary" diameterPx={1080} centreXFraction={0.1} centreYFraction={1.06} opacity={0.34} />
          </div>

          <Header />
          <Suspense>{props.children}</Suspense>
          <Footer />
          <ConsentBanner />
          <StarCheck />
          <Reveal />
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}