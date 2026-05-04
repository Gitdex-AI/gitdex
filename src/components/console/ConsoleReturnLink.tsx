import { Button } from "@mantine/core";
import { ArrowLeft } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { ConsoleReturnDestination } from "@/lib/return-navigation";

export function ConsoleReturnLink({
  destination,
  children = "Back",
  ...props
}: {
  destination: ConsoleReturnDestination;
  children?: ReactNode;
} & Omit<ComponentProps<typeof Button>, "component" | "href" | "leftSection" | "children">) {
  return (
    <Button component="a" href={destination.href} variant="subtle" leftSection={<ArrowLeft size={16} />} {...props}>
      {children}
    </Button>
  );
}
