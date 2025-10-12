import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toMadridDateString, formatMadridDate } from "@/lib/date-utils";

interface DatePickerProps {
  selectedDate: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  availableDates?: string[];
  placeholder?: string;
}

export function DatePicker({
  selectedDate,
  onDateChange,
  availableDates,
  placeholder = "Seleccionar fecha",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const formatDate = (date: Date | undefined) => {
    if (!date) return placeholder;
    return formatMadridDate(date, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const isDateAvailable = (date: Date) => {
    if (!availableDates || availableDates.length === 0) return true;
    const dateString = toMadridDateString(date);
    return availableDates.includes(dateString);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-14 px-6 text-lg justify-start text-left font-normal min-w-[280px]",
            !selectedDate && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-3 h-6 w-6" />
          {formatDate(selectedDate)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            onDateChange(date);
            setOpen(false);
          }}
          disabled={(date) => !isDateAvailable(date)}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
