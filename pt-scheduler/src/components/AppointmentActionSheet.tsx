import { Phone, Navigation, Edit3, Move, Trash2, X } from "lucide-react";
import type { Appointment, Patient } from "../types";

interface AppointmentActionSheetProps {
    appointment: Appointment;
    patient: Patient | undefined;
    isOpen: boolean;
    onClose: () => void;
    onCall: () => void;
    onNavigate: () => void;
    onViewEdit: () => void;
    onMove: () => void;
    onDelete: () => void;
}

export function AppointmentActionSheet({
    appointment,
    patient,
    isOpen,
    onClose,
    onCall,
    onNavigate,
    onViewEdit,
    onMove,
    onDelete,
}: AppointmentActionSheetProps) {
    if (!isOpen) {
        return null;
    }

    const patientName = patient?.fullName ?? "Unknown Patient";
    const hasPhone = Boolean(patient?.phone);
    const hasAddress = Boolean(patient?.address);

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-t-xl shadow-2xl w-full max-w-md mx-4 mb-0 animate-slide-up safe-area-pb"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[#dadce0]">
                    <h3 className="text-base font-medium text-[#202124] truncate pr-4">
                        {patientName}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-[#f1f3f4] transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5 text-[#5f6368]" />
                    </button>
                </div>

                {/* Action buttons */}
                <div className="p-2">
                    {/* Call Patient */}
                    {hasPhone && (
                        <button
                            onClick={() => {
                                onCall();
                                onClose();
                            }}
                            className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                        >
                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#e8f0fe]">
                                <Phone className="w-5 h-5 text-[#1a73e8]" />
                            </div>
                            <span className="font-medium">Call Patient</span>
                        </button>
                    )}

                    {/* Navigate to Address */}
                    {hasAddress && (
                        <button
                            onClick={() => {
                                onNavigate();
                                onClose();
                            }}
                            className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                        >
                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#e6f4ea]">
                                <Navigation className="w-5 h-5 text-[#1e8e3e]" />
                            </div>
                            <span className="font-medium">Navigate to Address</span>
                        </button>
                    )}

                    {/* View / Edit Details */}
                    <button
                        onClick={() => {
                            onViewEdit();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#fef7e0]">
                            <Edit3 className="w-5 h-5 text-[#f9ab00]" />
                        </div>
                        <span className="font-medium">View / Edit Details</span>
                    </button>

                    {/* Move Appointment */}
                    <button
                        onClick={() => {
                            onMove();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#f3e8fd]">
                            <Move className="w-5 h-5 text-[#8e24aa]" />
                        </div>
                        <span className="font-medium">Move Appointment</span>
                    </button>

                    {/* Delete Appointment */}
                    <button
                        onClick={() => {
                            onDelete();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#fce8e6] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#fce8e6]">
                            <Trash2 className="w-5 h-5 text-[#d93025]" />
                        </div>
                        <span className="font-medium text-[#d93025]">Delete Appointment</span>
                    </button>
                </div>

                {/* Cancel button */}
                <div className="p-2 border-t border-[#dadce0]">
                    <button
                        onClick={onClose}
                        className="w-full py-3 px-4 text-center text-[#5f6368] hover:bg-[#f1f3f4] rounded-lg font-medium transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
