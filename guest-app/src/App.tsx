import { useEffect, type ReactNode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import config from "@config";
import { Analytics } from "./components/Analytics";
import { PageMeta } from "./components/PageMeta";
import { AboutPage } from "./pages/AboutPage";
import { BookingConfirmPage } from "./pages/BookingConfirmPage";
import { BookingLookupPage } from "./pages/BookingLookupPage";
import { BookingPage } from "./pages/BookingPage";
import { ContactPage } from "./pages/ContactPage";
import { CorporateBookingPage } from "./pages/CorporateBookingPage";
import { CorporateStaysPage } from "./pages/CorporateStaysPage";
import { HomePage } from "./pages/HomePage";
import { IntercomPage } from "./pages/IntercomPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RewardsPage } from "./pages/RewardsPage";
import { RewardsLandingPage } from "./pages/RewardsLandingPage";
import { RoomsPage } from "./pages/RoomsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { StaysPage } from "./pages/StaysPage";
import { TermsPage } from "./pages/TermsPage";

export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Analytics />
      <Routes>
        <Route
          path="/"
          element={
            <WithMeta title={config.pageTitle} description={`Book a peaceful, consistent boutique hotel stay at ${config.brandName}.`}>
              <HomePage />
            </WithMeta>
          }
        />
        <Route
          path="/rooms"
          element={
            <WithMeta title="Rooms" description={`Explore room options, amenities, and direct booking rates at ${config.brandName}.`}>
              <RoomsPage />
            </WithMeta>
          }
        />
        <Route
          path="/book"
          element={
            <WithMeta title="Book a Stay" description={`Choose dates, select a room, and review your direct booking at ${config.brandName}.`} noIndex>
              <BookingPage />
            </WithMeta>
          }
        />
        <Route
          path="/book/confirm"
          element={
            <WithMeta title="Booking Confirmation" description={`Review your ${config.brandName} booking confirmation and next steps.`} noIndex>
              <BookingConfirmPage />
            </WithMeta>
          }
        />
        <Route
          path="/my-booking"
          element={
            <WithMeta title="My Booking" description={`Look up your ${config.brandName} reservation using your booking reference and email.`} noIndex>
              <BookingLookupPage />
            </WithMeta>
          }
        />
        <Route
          path="/corporate"
          element={
            <WithMeta title="Corporate Stays" description={`Corporate room blocks and business stays in ${config.address.city}, ${config.address.region}.`}>
              <CorporateStaysPage />
            </WithMeta>
          }
        />
        <Route
          path="/corporate/book"
          element={
            <WithMeta title="Corporate Booking" description="Access negotiated corporate rates or continue with flat business rates." noIndex>
              <CorporateBookingPage />
            </WithMeta>
          }
        />
        <Route
          path="/rewards"
          element={
            <WithMeta title={config.rewardsName} description={`Join ${config.rewardsName} and earn member perks on future ${config.brandName} stays.`}>
              <RewardsLandingPage />
            </WithMeta>
          }
        />
        <Route
          path="/signin"
          element={
            <WithMeta title="Sign In" description={`Sign in to your ${config.brandName} account.`} noIndex>
              <SignInPage />
            </WithMeta>
          }
        />
        <Route
          path="/signup"
          element={
            <WithMeta title="Sign Up" description={`Create your ${config.brandName} guest account.`} noIndex>
              <SignUpPage />
            </WithMeta>
          }
        />
        <Route
          path="/account/profile"
          element={
            <WithMeta title="Profile" description={`Manage your ${config.brandName} guest profile.`} noIndex>
              <ProfilePage />
            </WithMeta>
          }
        />
        <Route
          path="/account/stays"
          element={
            <WithMeta title="My Stays" description={`Review your previous and upcoming ${config.brandName} stays.`} noIndex>
              <StaysPage />
            </WithMeta>
          }
        />
        <Route
          path="/account/rewards"
          element={
            <WithMeta title="My Rewards" description={`Track your ${config.rewardsName} points and member perks.`} noIndex>
              <RewardsPage />
            </WithMeta>
          }
        />
        <Route
          path="/intercom/:roomId"
          element={
            <WithMeta title="Guest Intercom" description="Request front desk help from your room." noIndex>
              <IntercomPage />
            </WithMeta>
          }
        />
        <Route
          path="/about"
          element={
            <WithMeta title="About Us" description={`Learn the story, mission, and hospitality promise behind ${config.brandName}.`}>
              <AboutPage />
            </WithMeta>
          }
        />
        <Route
          path="/contact"
          element={
            <WithMeta title="Contact Us" description={`Find ${config.brandName} contact details, address, and map location in ${config.address.city}.`}>
              <ContactPage />
            </WithMeta>
          }
        />
        <Route
          path="/privacy"
          element={
            <WithMeta title="Privacy Policy" description={`Read how ${config.brandName} handles guest personal data and privacy rights.`} noIndex>
              <PrivacyPage />
            </WithMeta>
          }
        />
        <Route
          path="/terms"
          element={
            <WithMeta title="Terms of Service" description={`Read ${config.brandName} booking, cancellation, discount, and guest stay terms.`} noIndex>
              <TermsPage />
            </WithMeta>
          }
        />
        <Route
          path="*"
          element={
            <WithMeta title="Page Not Found" description={`This ${config.brandName} page could not be found.`} noIndex>
              <NotFoundPage />
            </WithMeta>
          }
        />
      </Routes>
    </>
  );
}

interface WithMetaProps {
  children: ReactNode;
  description: string;
  noIndex?: boolean;
  title: string;
}

function WithMeta({ children, description, noIndex, title }: WithMetaProps) {
  return (
    <>
      <PageMeta title={title} description={description} noIndex={noIndex} />
      {children}
    </>
  );
}
