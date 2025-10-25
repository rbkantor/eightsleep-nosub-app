"use client";

import { useState } from "react";
import { apiR } from "~/trpc/react";
import { Button } from "~/components/ui/button";

interface TemperatureData {
  timestamp: string;
  temperature: number;
}

interface Interval {
  id: string;
  ts: string;
  stages: Array<{
    stage: string;
    duration: number;
  }>;
  score: number;
  timeseries: {
    tnt: Array<[string, number]>;
    tempBedC: Array<[string, number]>;
    tempRoomC: Array<[string, number]>;
    respiratoryRate: Array<[string, number]>;
    heartRate: Array<[string, number]>;
  };
  incomplete: boolean;
}

export function TemperatureIntervalsButton() {
  const [showData, setShowData] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = apiR.user.getTemperatureIntervals.useQuery(
    undefined,
    { enabled: showData }
  );

  const handleToggle = () => {
    setShowData(!showData);
    if (!showData) {
      refetch();
    }
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <Button
        onClick={handleToggle}
        className="bg-[hsl(280,100%,70%)] hover:bg-[hsl(280,100%,60%)] text-white"
      >
        {showData ? "Hide" : "Show"} Temperature Interval Data
      </Button>

      {showData && (
        <div className="mt-6 bg-white rounded-lg p-6 shadow-xl text-gray-800 max-h-[600px] overflow-y-auto">
          <h2 className="text-2xl font-bold mb-4">Temperature Intervals</h2>

          {isLoading && (
            <div className="flex items-center justify-center p-8">
              <div className="text-lg">Loading interval data...</div>
            </div>
          )}

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              Error loading data: {error.message}
            </div>
          )}

          {data?.intervals && data.intervals.length === 0 && (
            <div className="text-center p-8 text-gray-500">
              {data.message || "No temperature interval data available yet. Sleep data will appear after using your mattress."}
            </div>
          )}

          {data?.intervals && data.intervals.length > 0 && (
            <div className="space-y-4">
              {data.intervals.map((interval: Interval, index: number) => (
                <div
                  key={interval.id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div
                    className="cursor-pointer"
                    onClick={() =>
                      setSelectedInterval(selectedInterval === index ? null : index)
                    }
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-lg">
                          Sleep Session {data.intervals.length - index}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {formatDate(interval.ts)}
                        </p>
                        <p className="text-sm text-gray-600">
                          Sleep Score: {interval.score}/100
                        </p>
                        {interval.incomplete && (
                          <span className="inline-block mt-1 bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">
                            Incomplete
                          </span>
                        )}
                      </div>
                      <button className="text-[hsl(280,100%,70%)] font-bold">
                        {selectedInterval === index ? "▼" : "▶"}
                      </button>
                    </div>
                  </div>

                  {selectedInterval === index && (
                    <div className="mt-4 space-y-4">
                      {/* Sleep Stages */}
                      <div>
                        <h4 className="font-semibold mb-2">Sleep Stages:</h4>
                        <div className="space-y-1">
                          {interval.stages.map((stage, idx) => (
                            <div key={idx} className="flex justify-between text-sm">
                              <span className="capitalize">{stage.stage}:</span>
                              <span>{formatDuration(stage.duration)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Temperature Data */}
                      <div>
                        <h4 className="font-semibold mb-2">Bed Temperature:</h4>
                        {interval.timeseries.tempBedC.length > 0 ? (
                          <div className="bg-gray-50 p-3 rounded max-h-40 overflow-y-auto">
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              {interval.timeseries.tempBedC.slice(0, 10).map(([timestamp, temp], idx) => (
                                <div key={idx} className="flex justify-between">
                                  <span className="text-gray-600">
                                    {new Date(timestamp).toLocaleTimeString()}:
                                  </span>
                                  <span className="font-medium">{temp.toFixed(1)}°C</span>
                                </div>
                              ))}
                              {interval.timeseries.tempBedC.length > 10 && (
                                <div className="col-span-2 text-center text-gray-500 text-xs mt-2">
                                  ...and {interval.timeseries.tempBedC.length - 10} more readings
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No bed temperature data</p>
                        )}
                      </div>

                      {/* Room Temperature */}
                      <div>
                        <h4 className="font-semibold mb-2">Room Temperature:</h4>
                        {interval.timeseries.tempRoomC.length > 0 ? (
                          <div className="bg-gray-50 p-3 rounded">
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              {interval.timeseries.tempRoomC.slice(0, 5).map(([timestamp, temp], idx) => (
                                <div key={idx} className="flex justify-between">
                                  <span className="text-gray-600">
                                    {new Date(timestamp).toLocaleTimeString()}:
                                  </span>
                                  <span className="font-medium">{temp.toFixed(1)}°C</span>
                                </div>
                              ))}
                              {interval.timeseries.tempRoomC.length > 5 && (
                                <div className="col-span-2 text-center text-gray-500 text-xs mt-2">
                                  ...and {interval.timeseries.tempRoomC.length - 5} more readings
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No room temperature data</p>
                        )}
                      </div>

                      {/* Heart Rate */}
                      <div>
                        <h4 className="font-semibold mb-2">Heart Rate:</h4>
                        {interval.timeseries.heartRate.length > 0 ? (
                          <div className="bg-gray-50 p-3 rounded">
                            <div className="text-sm">
                              <span className="text-gray-600">Average: </span>
                              <span className="font-medium">
                                {(
                                  interval.timeseries.heartRate.reduce((sum, [, hr]) => sum + hr, 0) /
                                  interval.timeseries.heartRate.length
                                ).toFixed(1)}{" "}
                                bpm
                              </span>
                              <span className="text-gray-600 ml-4">
                                ({interval.timeseries.heartRate.length} readings)
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No heart rate data</p>
                        )}
                      </div>

                      {/* Respiratory Rate */}
                      <div>
                        <h4 className="font-semibold mb-2">Respiratory Rate:</h4>
                        {interval.timeseries.respiratoryRate.length > 0 ? (
                          <div className="bg-gray-50 p-3 rounded">
                            <div className="text-sm">
                              <span className="text-gray-600">Average: </span>
                              <span className="font-medium">
                                {(
                                  interval.timeseries.respiratoryRate.reduce((sum, [, rr]) => sum + rr, 0) /
                                  interval.timeseries.respiratoryRate.length
                                ).toFixed(1)}{" "}
                                breaths/min
                              </span>
                              <span className="text-gray-600 ml-4">
                                ({interval.timeseries.respiratoryRate.length} readings)
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No respiratory rate data</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
