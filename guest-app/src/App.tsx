import { Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { RoomsPage } from "./pages/RoomsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/rooms" element={<RoomsPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
