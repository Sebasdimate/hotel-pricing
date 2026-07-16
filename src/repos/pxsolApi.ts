import { formatDate } from "../utils/dateUtils";

export const pxsolEndpoints = {
  rooms: () =>
    `${process.env.PX_BASE_URL}/hotels/${process.env.PX_HOTEL_ID}/rooms`,  

  availability: (startDate: Date, endDate: Date) => {
    return (
      `${process.env.PX_BASE_URL}/hotels/${process.env.PX_HOTEL_ID}/availability` +
      `?start_date=${formatDate(startDate)}` +
      `&end_date=${formatDate(endDate)}`
    );
  },

  updateRates: () =>
    `${process.env.PX_BASE_URL}/hotels/${process.env.PX_HOTEL_ID}/availability`
};
