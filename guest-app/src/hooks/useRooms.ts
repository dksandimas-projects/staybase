import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/rooms";
import type { Room } from "@spark-inn/shared";

export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const roomsRef = collection(db, "rooms");

    const unsubscribe = onSnapshot(
      roomsRef,
      (snapshot) => {
        const roomsData: Room[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          roomsData.push({
            id: doc.id,
            name: data.name || "",
            roomNumber: data.roomNumber || "",
            type: data.type || "",
            description: data.description || "",
            bedDefinition: data.bedDefinition || "",
            amenities: data.amenities || [],
            isActive: data.isActive !== false,
            status: data.status || "available",
            housekeepingStatus: data.housekeepingStatus || "clean",
            blockReason: data.blockReason || "",
            remarks: data.remarks || "",
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          });
        });

        // Consistent sorting by room number (natural sort order)
        roomsData.sort((a, b) =>
          a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
        );

        setRooms(roomsData);
        setLoading(false);
      },
      (err) => {
        console.error("Error streaming rooms:", err);
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  return { rooms, loading, error };
}
