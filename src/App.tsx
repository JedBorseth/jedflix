import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { BrowsePage } from "@/pages/BrowsePage";
import { MovieDetailPage } from "@/pages/MovieDetailPage";
import { WatchPage } from "@/pages/WatchPage";
import { MyListPage } from "@/pages/MyListPage";
import { SignInForm } from "@/components/auth/SignInForm";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BrowsePage />} />
        <Route path="/movie/:movieId" element={<MovieDetailPage />} />
        <Route path="/watch/:movieId" element={<WatchPage />} />
        <Route path="/my-list" element={<MyListPage />} />
        <Route path="/sign-in" element={<SignInForm />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
