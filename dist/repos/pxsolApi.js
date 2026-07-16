"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pxsolEndpoints = void 0;
const dateUtils_1 = require("../utils/dateUtils");
exports.pxsolEndpoints = {
    rooms: () => `${process.env.PX_BASE_URL}/hotels/${process.env.PX_HOTEL_ID}/rooms`,
    availability: (startDate, endDate) => {
        return (`${process.env.PX_BASE_URL}/hotels/${process.env.PX_HOTEL_ID}/availability` +
            `?start_date=${(0, dateUtils_1.formatDate)(startDate)}` +
            `&end_date=${(0, dateUtils_1.formatDate)(endDate)}`);
    },
    updateRates: () => `${process.env.PX_BASE_URL}/hotels/${process.env.PX_HOTEL_ID}/availability`
};
